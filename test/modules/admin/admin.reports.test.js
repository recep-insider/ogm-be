'use strict';

// Tablo başına sonuç kuyruğu + çağrı kaydı tutan knex taklidi.
const mockResults = {};
const mockCalls = [];

jest.mock('../../../src/config/db', () => {
  const dbFn = jest.fn((table) => {
    const entry = { table, calls: [] };
    mockCalls.push(entry);
    const chain = {};
    for (const method of ['where', 'whereIn', 'whereNull', 'select', 'count', 'countDistinct', 'groupBy', 'orderBy']) {
      chain[method] = jest.fn((...args) => {
        entry.calls.push([method, ...args]);
        return chain;
      });
    }
    const next = () => Promise.resolve(mockResults[table].shift());
    chain.first = jest.fn(next);
    chain.then = (resolve, reject) => next().then(resolve, reject);
    return chain;
  });
  dbFn.raw = jest.fn((sql, bindings) => ({ __raw: sql, bindings }));
  return { db: dbFn };
});
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/modules/users/readiness.service', () => ({}));
jest.mock('../../../src/modules/equipment/equipment.service', () => ({ PROTECTIVE_TYPE: 'Koruyucu Ekipman' }));

const { reportsSummary, reportsSeries } = require('../../../src/modules/admin/admin.service');
const { citiesOfRegion } = require('../../../src/shared/regions');

const callsFor = (table) => mockCalls.filter((e) => e.table === table);

beforeEach(() => {
  mockCalls.length = 0;
  Object.assign(mockResults, {
    fire_reports: [[{ status: 'confirmed', c: 3 }, { status: 'rejected', c: 1 }], []],
    users: [{ c: 10 }, { c: 8 }],
    mission_participants: [{ c: 4 }, { c: 2 }],
    missions: [{ c: 5 }, { c: 1 }],
    sos_reports: [{ c: 2 }, { c: 0 }],
  });
});

describe('admin.service — reportsSummary', () => {
  const from = new Date('2026-06-01T00:00:00Z');
  const to = new Date('2026-07-01T00:00:00Z');

  test('missions KPI: pencerede açılan olay sayısı, durum filtresi yok (arşiv dahil)', async () => {
    const result = await reportsSummary({ from, to });

    expect(result.kpis.missions).toEqual({ current: 5, previous: 1 });
    const [current] = callsFor('missions');
    expect(current.calls).toEqual(expect.arrayContaining([
      ['where', 'created_at', '>=', from],
      ['where', 'created_at', '<', to],
    ]));
    expect(current.calls.some(([m]) => m === 'whereIn')).toBe(false);
    expect(current.calls.some(([m, arg]) => m === 'where' && typeof arg === 'object')).toBe(false);
  });

  test('activeVolunteers yalnızca yola çıkan/sahaya giren gönüllüyü sayar (cagrildi hariç)', async () => {
    const result = await reportsSummary({ from, to });

    expect(result.kpis.activeVolunteers).toEqual({ current: 4, previous: 2 });
    for (const entry of callsFor('mission_participants')) {
      expect(entry.calls).toContainEqual(['whereIn', 'status', ['yolda', 'sahada', 'tamamladi']]);
    }
    expect(result.kpis.fires).toEqual({ current: 3, previous: 0 });
    expect(result.kpis.reportAccuracy).toEqual({ current: 75, previous: 0 });
  });
});

describe('admin.service — reportsSummary bölge süzmesi', () => {
  const from = new Date('2026-06-01T00:00:00Z');
  const to = new Date('2026-07-01T00:00:00Z');
  const EGE = citiesOfRegion('ege');
  const hasIlFilter = (entry) => entry.calls.some(([m, col, val]) => m === 'whereIn' && col === 'il' && val === EGE);

  test('sos KPI: pencerede açılan SOS çağrısı sayısı', async () => {
    const result = await reportsSummary({ from, to });

    expect(result.kpis.sos).toEqual({ current: 2, previous: 0 });
    expect(callsFor('sos_reports')[0].calls).toEqual(expect.arrayContaining([
      ['where', 'created_at', '>=', from],
      ['where', 'created_at', '<', to],
    ]));
  });

  test('region verilince olay/ihbar/gönüllü/SOS sayıları kendi il kolonundan, iki pencerede de süzülür', async () => {
    const result = await reportsSummary({ from, to, region: 'ege' });

    expect(result.region).toBe('ege');
    for (const table of ['missions', 'fire_reports', 'sos_reports']) {
      const entries = callsFor(table);
      expect(entries).toHaveLength(2);
      expect(entries.every(hasIlFilter)).toBe(true);
    }
    // users: iki kümülatif sayaç + görev almış gönüllü için iki alt sorgu — hepsi users.il'den.
    const users = callsFor('users');
    expect(users).toHaveLength(4);
    expect(users.every(hasIlFilter)).toBe(true);
  });

  test('görev almış gönüllü, users.il bölgedeki kullanıcılarla sınırlanır', async () => {
    await reportsSummary({ from, to, region: 'ege' });

    for (const entry of callsFor('mission_participants')) {
      const filter = entry.calls.find(([m, col]) => m === 'whereIn' && col === 'user_id');
      expect(filter).toBeDefined();
      const sub = mockCalls.find((e) => e.table === 'users' && e.calls.some(([m, col]) => m === 'select' && col === 'id'));
      expect(hasIlFilter(sub)).toBe(true);
    }
  });

  test.each([[undefined], ['all']])('region=%p hiçbir kaydı elemez', async (region) => {
    const result = await reportsSummary({ from, to, region });

    expect(result.region).toBe('all');
    expect(mockCalls.some(hasIlFilter)).toBe(false);
    for (const entry of callsFor('mission_participants')) {
      expect(entry.calls.some(([m, col]) => m === 'whereIn' && col === 'user_id')).toBe(false);
    }
  });
});

describe('admin.service — reportsSeries', () => {
  test('missions serisi missions.created_at ile kovalanır', async () => {
    mockResults.missions = [[{ bucket: '2026-06-01', c: '2' }]];
    const from = new Date('2026-06-01T00:00:00Z');
    const to = new Date('2026-06-08T00:00:00Z');

    const result = await reportsSeries({ metric: 'missions', interval: 'day', from, to });

    expect(result).toEqual({ metric: 'missions', interval: 'day', series: [{ bucket: '2026-06-01', count: 2 }] });
    expect(callsFor('missions')[0].calls).toEqual(expect.arrayContaining([
      ['where', 'created_at', '>=', from],
      ['where', 'created_at', '<', to],
    ]));
  });

  const from = new Date('2026-06-01T00:00:00Z');
  const to = new Date('2026-06-08T00:00:00Z');

  test.each([['missions', 'missions'], ['fireReports', 'fire_reports'], ['confirmedFireReports', 'fire_reports'], ['newUsers', 'users']])(
    '%s serisi region ile il kolonundan süzülür (özetle aynı kural)',
    async (metric, table) => {
      mockResults[table] = [[]];

      await reportsSeries({ metric, interval: 'day', from, to, region: 'ege' });

      expect(callsFor(table)[0].calls).toContainEqual(['whereIn', 'il', citiesOfRegion('ege')]);
    },
  );

  test('region=all seriyi süzmez', async () => {
    mockResults.missions = [[]];

    await reportsSeries({ metric: 'missions', interval: 'day', from, to, region: 'all' });

    expect(callsFor('missions')[0].calls.some(([m]) => m === 'whereIn')).toBe(false);
  });

  test('il taşımayan emergency metriği bölgeyle istenirse 400 döner, süzülmemiş sayı dönmez', async () => {
    await expect(reportsSeries({ metric: 'emergency', interval: 'day', from, to, region: 'ege' }))
      .rejects.toMatchObject({ status: 400, code: 'region_not_supported' });
    expect(callsFor('emergency_reports')).toHaveLength(0);
  });

  test('emergency metriği bölgesiz çalışmaya devam eder', async () => {
    mockResults.emergency_reports = [[{ bucket: '2026-06-01', c: 1 }]];

    const result = await reportsSeries({ metric: 'emergency', interval: 'day', from, to, region: 'all' });

    expect(result.series).toEqual([{ bucket: '2026-06-01', count: 1 }]);
  });
});
