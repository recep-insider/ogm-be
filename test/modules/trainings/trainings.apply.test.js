'use strict';

// K4: saha training capacity is a hard limit (410 training_full); face-to-face theory
// trainings expose their session (startsAt, location, instructor) on GET /trainings/online.
// Past field trainings (day before today, Europe/Istanbul) are neither listed nor applicable.

const mockState = { training: null, existing: null, enrolled: 0, rejected: 0, inserts: [], online: [], progress: [], saha: [], whereCalls: [], ops: [] };

jest.mock('../../../src/config/db', () => {
  // `via` tells a transaction-bound query (trx) apart from one on the bare pool (db).
  const makeChain = (table, via = 'db') => {
    let counting = false;
    const log = (op) => mockState.ops.push({ via, table, op });
    let excludesRejected = false;
    // Rejected applications only reach a count that forgets to leave them out.
    const heldSeats = () => mockState.enrolled + (excludesRejected ? 0 : mockState.rejected);
    const c = {
      where: jest.fn((...args) => {
        mockState.whereCalls.push({ table, args });
        return c;
      }),
      whereNot: jest.fn((cond) => {
        if (cond && cond.status === 'rejected') excludesRejected = true;
        return c;
      }),
      pluck: jest.fn(async () => []),
      select: jest.fn(() => c),
      groupBy: jest.fn(async () => (heldSeats() ? [{ attendance: 'kayitli', c: heldSeats() }] : [])),
      orderBy: jest.fn(() => c),
      forUpdate: jest.fn(() => {
        log('forUpdate');
        return c;
      }),
      count: jest.fn(() => {
        log('count');
        counting = true;
        return c;
      }),
      first: jest.fn(async () => {
        log('first');
        if (table === 'saha_trainings') return mockState.training;
        if (table === 'saha_training_applications') {
          return counting ? { c: heldSeats() } : mockState.existing;
        }
        return undefined;
      }),
      insert: jest.fn(async (row) => {
        log('insert');
        mockState.inserts.push(row);
        return [1];
      }),
      then: (resolve, reject) => {
        const rows = {
          online_trainings: mockState.online,
          online_training_progress: mockState.progress,
          saha_trainings: mockState.saha,
        }[table] || [];
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return c;
  };
  const trx = jest.fn((t) => makeChain(t, 'trx'));
  const db = Object.assign(jest.fn((t) => makeChain(t)), {
    raw: jest.fn(),
    transaction: jest.fn(async (cb) => cb(trx)),
  });
  return { db };
});
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/shared/asset-url', () => ({ assetUrl: (rel) => (rel ? `https://cdn.test/${rel}` : null) }));
jest.mock('../../../src/modules/equipment/equipment.service', () => ({ deliverKkdSet: jest.fn() }));

const { applySaha, listOnline, listSaha } = require('../../../src/modules/trainings/trainings.service');

beforeEach(() => {
  mockState.training = { id: 's1', is_active: 1, total_seats: 30, start_date: '2026-10-02' };
  mockState.existing = null;
  mockState.enrolled = 0;
  mockState.rejected = 0;
  mockState.inserts = [];
  mockState.online = [];
  mockState.progress = [];
  mockState.saha = [];
  mockState.whereCalls = [];
  mockState.ops = [];
});

describe('applySaha — hard capacity (K4)', () => {
  it('auto-approves while seats remain', async () => {
    mockState.enrolled = 29;
    const result = await applySaha('u1', 's1');
    expect(result).toMatchObject({ status: 'approved', attendance: 'kayitli' });
    expect(mockState.inserts).toHaveLength(1);
  });

  it('answers 410 training_full once seats are taken and records nothing', async () => {
    mockState.enrolled = 30;
    await expect(applySaha('u1', 's1')).rejects.toMatchObject({ status: 410, code: 'training_full' });
    expect(mockState.inserts).toHaveLength(0);
  });

  it('keeps 409 already_applied for an enrolled volunteer even when full', async () => {
    mockState.enrolled = 30;
    mockState.existing = { id: 'a1' };
    await expect(applySaha('u1', 's1')).rejects.toMatchObject({ status: 409, code: 'already_applied' });
  });

  it('does not let rejected applications hold a seat', async () => {
    mockState.enrolled = 29;
    mockState.rejected = 3;
    await expect(applySaha('u1', 's1')).resolves.toMatchObject({ status: 'approved' });
    expect(mockState.inserts).toHaveLength(1);
  });

  it('still answers 410 training_closed for an inactive training', async () => {
    mockState.training.is_active = 0;
    await expect(applySaha('u1', 's1')).rejects.toMatchObject({ code: 'training_closed' });
  });

  it('answers 404 not_found for an unknown training and records nothing', async () => {
    mockState.training = null;
    await expect(applySaha('u1', 'missing')).rejects.toMatchObject({ status: 404, code: 'not_found' });
    expect(mockState.inserts).toHaveLength(0);
  });

  it('answers 410 training_full for a 0-seat (legacy default) training', async () => {
    mockState.training.total_seats = 0;
    mockState.enrolled = 0;
    await expect(applySaha('u1', 's1')).rejects.toMatchObject({ status: 410, code: 'training_full' });
    expect(mockState.inserts).toHaveLength(0);
  });
});

describe('applySaha — row lock against concurrent applications', () => {
  const opsOn = (table) => mockState.ops.filter((o) => o.table === table);

  it('reads the training row under FOR UPDATE inside the transaction', async () => {
    await applySaha('u1', 's1');

    // The lock must be taken before the row is read, on the transaction connection.
    expect(opsOn('saha_trainings')).toEqual([
      { via: 'trx', table: 'saha_trainings', op: 'forUpdate' },
      { via: 'trx', table: 'saha_trainings', op: 'first' },
    ]);
  });

  it('counts held seats on the same transaction that holds the lock', async () => {
    await applySaha('u1', 's1');

    const counts = opsOn('saha_training_applications').filter((o) => o.op === 'count');
    expect(counts).toEqual([{ via: 'trx', table: 'saha_training_applications', op: 'count' }]);
  });

  it('inserts the application on the same transaction, never on the bare pool', async () => {
    await applySaha('u1', 's1');

    const inserts = opsOn('saha_training_applications').filter((o) => o.op === 'insert');
    expect(inserts).toEqual([{ via: 'trx', table: 'saha_training_applications', op: 'insert' }]);
    expect(mockState.ops.filter((o) => o.via === 'db')).toEqual([]);
  });
});

describe('listOnline — face-to-face session fields', () => {
  const base = { title: 'T', duration_min: 60, icon_tone: 'primary', required: 1 };

  it('returns startsAt/location/instructor for yuzyuze trainings', async () => {
    mockState.online = [{
      ...base,
      id: 'o1',
      delivery: 'yuzyuze',
      session_starts_at: new Date('2026-10-01T07:00:00Z'),
      session_location: 'Muğla OBM Konferans Salonu',
      session_instructor: 'Ayşe Demir',
    }];
    const [t] = await listOnline('u1');
    expect(t).toMatchObject({
      delivery: 'yuzyuze',
      startsAt: '2026-10-01T07:00:00.000Z',
      location: 'Muğla OBM Konferans Salonu',
      instructor: 'Ayşe Demir',
    });
  });

  it('returns null session fields for online trainings and unset sessions', async () => {
    mockState.online = [
      { ...base, id: 'o2', delivery: 'online', session_location: 'stale' },
      { ...base, id: 'o3', delivery: 'yuzyuze' },
    ];
    const list = await listOnline('u1');
    for (const t of list) {
      expect(t).toMatchObject({ startsAt: null, location: null, instructor: null });
    }
  });
});

describe('field trainings in the past (Europe/Istanbul day)', () => {
  // 2026-09-25 00:30 in Turkey is still 2026-09-24 in UTC.
  const NOW = new Date('2026-09-24T21:30:00Z');

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('answers 410 training_past for a training dated before today and records nothing', async () => {
    mockState.training.start_date = '2026-09-18';
    await expect(applySaha('u1', 's1')).rejects.toMatchObject({ status: 410, code: 'training_past' });
    expect(mockState.inserts).toHaveLength(0);
  });

  it('judges "today" by the Istanbul day, so yesterday is already past just after local midnight', async () => {
    mockState.training.start_date = new Date('2026-09-24T00:00:00Z');
    await expect(applySaha('u1', 's1')).rejects.toMatchObject({ code: 'training_past' });
  });

  it('still accepts an application for a training held today', async () => {
    mockState.training.start_date = '2026-09-25';
    await expect(applySaha('u1', 's1')).resolves.toMatchObject({ status: 'approved' });
    expect(mockState.inserts).toHaveLength(1);
  });

  it('reports training_closed before training_past for an inactive past training', async () => {
    mockState.training = { ...mockState.training, is_active: 0, start_date: '2026-09-18' };
    await expect(applySaha('u1', 's1')).rejects.toMatchObject({ code: 'training_closed' });
  });

  it('leaves rejected applications out of the listed seat counts', async () => {
    mockState.saha = [{ id: 's2', title: 'T', total_seats: 30, start_date: '2026-09-25' }];
    mockState.enrolled = 29;
    mockState.rejected = 4;
    const [t] = await listSaha('u1');

    expect(t).toMatchObject({ enrolled: 29, availableSeats: 1, seatStatus: 'last_seats' });
  });

  it('lists only trainings dated from today (Istanbul) onwards', async () => {
    mockState.saha = [{ id: 's2', title: 'T', total_seats: 30, start_date: '2026-09-25' }];
    const list = await listSaha('u1');

    expect(list.map((t) => t.id)).toEqual(['s2']);
    expect(mockState.whereCalls).toContainEqual({
      table: 'saha_trainings',
      args: ['start_date', '>=', '2026-09-25'],
    });
  });
});
