'use strict';

// Panelin kilitli eğitim alanları: teorik eğitime kapak + içerik, saha eğitimine açıklama +
// içerik. Yazılan her alan admin liste/tekil ve mobil liste yanıtlarında döner (SEAR-3632).
// Toplu başvuru listesi tüm saha eğitimlerini sayfalı ve trainingId'li döner.

const mockDb = { rows: {}, counted: {}, first: {}, chains: [], inserts: [], updates: [] };

jest.mock('../../../src/config/db', () => {
  const makeChain = (table, calls = []) => {
    const c = { table, calls, counting: false };
    for (const m of ['where', 'whereNot', 'select', 'orderBy', 'leftJoin', 'join', 'groupBy', 'limit', 'offset', 'max']) {
      c[m] = jest.fn((...args) => {
        c.calls.push([m, ...args]);
        return c;
      });
    }
    c.count = jest.fn((...args) => {
      c.calls.push(['count', ...args]);
      c.counting = true;
      return c;
    });
    c.pluck = jest.fn(async () => []);
    c.clone = jest.fn(() => makeChain(table, [...c.calls]));
    c.first = jest.fn(async () => mockDb.first[table]);
    c.insert = jest.fn(async (row) => {
      mockDb.inserts.push(row);
      return [1];
    });
    c.update = jest.fn(async (row) => {
      mockDb.updates.push(row);
      return 1;
    });
    c.then = (resolve, reject) =>
      Promise.resolve(c.counting ? mockDb.counted[table] || [] : mockDb.rows[table] || []).then(resolve, reject);
    mockDb.chains.push(c);
    return c;
  };
  const dbFn = jest.fn((table) => makeChain(table));
  dbFn.raw = jest.fn((sql) => ({ __raw: sql }));
  return { db: dbFn };
});
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/shared/asset-url', () => ({
  assetUrl: (rel) => (rel ? (/^https?:\/\//.test(rel) ? rel : `https://cdn.test/${rel}`) : null),
}));
jest.mock('../../../src/modules/equipment/equipment.service', () => ({ deliverKkdSet: jest.fn() }));

const service = require('../../../src/modules/trainings/trainings.service');

const BLOCKS = [
  { type: 'paragraph', text: 'Giriş' },
  { type: 'image', source: 'content/a.jpg', caption: 'Ekipman' },
  { type: 'video', source: 'https://cdn.example/v.mp4?sig=1', caption: 'Tanıtım' },
];
const STORED = JSON.stringify(BLOCKS);

beforeEach(() => {
  mockDb.rows = {};
  mockDb.counted = {};
  mockDb.first = {};
  mockDb.chains = [];
  mockDb.inserts = [];
  mockDb.updates = [];
});

describe('theory training write path', () => {
  it('stores cover_path and the content blocks as JSON on create', async () => {
    mockDb.first.online_trainings = { m: 2 };
    await service.adminCreateOnline({ title: 'T', durationMin: 30, coverPath: 'content/k.jpg', content: BLOCKS });

    const [row] = mockDb.inserts;
    expect(row.cover_path).toBe('content/k.jpg');
    expect(JSON.parse(row.content)).toEqual(BLOCKS);
  });

  it('clears the cover on null and leaves cover/content alone when absent', async () => {
    mockDb.first.online_trainings = { id: 'o1' };
    await service.adminUpdateOnline('o1', { coverPath: null, content: [] });
    await service.adminUpdateOnline('o1', { title: 'Yeni' });

    expect(mockDb.updates[0]).toMatchObject({ cover_path: null, content: '[]' });
    expect(mockDb.updates[1]).not.toHaveProperty('cover_path');
    expect(mockDb.updates[1]).not.toHaveProperty('content');
  });
});

describe('field training write path', () => {
  it('stores description and content on update; an empty description becomes null', async () => {
    mockDb.first.saha_trainings = { id: 's1', start_date: '2030-01-01' };
    await service.adminUpdateSaha('s1', { description: 'Saha açıklaması', content: BLOCKS });
    await service.adminUpdateSaha('s1', { description: '' });

    expect(mockDb.updates[0].description).toBe('Saha açıklaması');
    expect(JSON.parse(mockDb.updates[0].content)).toEqual(BLOCKS);
    expect(mockDb.updates[1].description).toBeNull();
    expect(mockDb.updates[1]).not.toHaveProperty('content');
  });

  it('stores description and content on create', async () => {
    await service.adminCreateSaha({
      title: 'S', location: 'L', startDate: '2030-01-01', startTime: '09:00', endTime: '17:00',
      instructorName: 'E', totalSeats: 10, description: 'Açıklama', content: BLOCKS,
    });

    const [row] = mockDb.inserts;
    expect(row.description).toBe('Açıklama');
    expect(JSON.parse(row.content)).toEqual(BLOCKS);
  });
});

describe('admin read paths', () => {
  it('returns cover, coverPath, videoPath and content (image with sourceUrl) for theory trainings', async () => {
    mockDb.rows['online_trainings as t'] = [
      { id: 'o1', title: 'T', video_path: 'content/v.mp4', cover_path: 'content/k.jpg', content: STORED },
      { id: 'o2', title: 'Boş', video_path: null, cover_path: null, content: null },
    ];

    const { items } = await service.adminListOnline({});

    expect(items[0]).toMatchObject({
      videoPath: 'content/v.mp4',
      videoUrl: 'https://cdn.test/content/v.mp4',
      cover: 'https://cdn.test/content/k.jpg',
      coverPath: 'content/k.jpg',
    });
    expect(items[0].content[1]).toEqual({
      type: 'image', source: 'content/a.jpg', sourceUrl: 'https://cdn.test/content/a.jpg', caption: 'Ekipman',
    });
    expect(items[0].content[2]).toEqual(BLOCKS[2]);
    expect(items[1]).toMatchObject({ videoPath: null, cover: null, coverPath: null, content: [] });
  });

  it('returns the same fields from the single-record view used by create/update', async () => {
    mockDb.first.online_trainings = { id: 'o1' };
    mockDb.first['online_trainings as t'] = { id: 'o1', cover_path: 'content/k.jpg', content: BLOCKS };

    const dto = await service.adminUpdateOnline('o1', { title: 'T' });

    expect(dto).toMatchObject({ coverPath: 'content/k.jpg', cover: 'https://cdn.test/content/k.jpg' });
    expect(dto.content).toHaveLength(3);
  });

  it('returns description and content for field trainings, list and single record', async () => {
    const row = { id: 's1', title: 'S', total_seats: 10, description: 'Açıklama', content: STORED };
    mockDb.rows['saha_trainings as t'] = [row, { id: 's2', title: 'Boş', total_seats: 5 }];
    mockDb.first.saha_trainings = { id: 's1', start_date: '2030-01-01' };
    mockDb.first['saha_trainings as t'] = row;

    const { items } = await service.adminListSaha({});
    const dto = await service.adminUpdateSaha('s1', { title: 'S' });

    expect(items[0]).toMatchObject({ description: 'Açıklama' });
    expect(items[0].content[1].sourceUrl).toBe('https://cdn.test/content/a.jpg');
    expect(items[1]).toMatchObject({ description: '', content: [] });
    expect(dto).toMatchObject({ description: 'Açıklama' });
    expect(dto.content).toHaveLength(3);
  });
});

describe('mobile read paths', () => {
  it('GET /trainings/online carries cover and content; image source is a full URL, caption kept', async () => {
    mockDb.rows.online_trainings = [{ id: 'o1', title: 'T', delivery: 'online', cover_path: 'content/k.jpg', content: STORED }];

    const [t] = await service.listOnline('u1');

    expect(t.cover).toBe('https://cdn.test/content/k.jpg');
    expect(t.content).toEqual([
      BLOCKS[0],
      { type: 'image', source: 'https://cdn.test/content/a.jpg', caption: 'Ekipman' },
      BLOCKS[2],
    ]);
  });

  it('GET /trainings/saha carries description and content', async () => {
    mockDb.rows.saha_trainings = [{ id: 's1', title: 'S', total_seats: 10, description: 'Açıklama', content: STORED }];

    const [t] = await service.listSaha('u1');

    expect(t.description).toBe('Açıklama');
    expect(t.content).toHaveLength(3);
    expect(t.content[1].source).toBe('https://cdn.test/content/a.jpg');
  });

  it('a field training without description or content answers empty values, not null', async () => {
    mockDb.rows.saha_trainings = [{ id: 's1', title: 'S', total_seats: 10 }];

    const [t] = await service.listSaha('u1');

    expect(t).toMatchObject({ description: '', content: [] });
  });

  it('the completed field training list carries the description, like the theory list', async () => {
    mockDb.rows['saha_training_applications as a'] = [{ training_id: 's1', title: 'S', description: 'Açıklama' }];

    const { uygulamali } = await service.listCompleted('u1');

    expect(uygulamali[0].description).toBe('Açıklama');
    const fieldQuery = mockDb.chains.find((c) => c.table === 'saha_training_applications as a');
    expect(fieldQuery.calls.find(([m]) => m === 'select')).toContain('t.description');
  });
});

describe('adminListAllSahaApplications', () => {
  const appRow = {
    id: 'a1', training_id: 's1', user_id: 'u1', status: 'approved', attendance: 'katildi',
    attendance_at: new Date('2026-10-01T09:00:00Z'), kkd_delivered: 1, created_at: new Date('2026-09-01T09:00:00Z'),
    user_ad: 'Ali', user_soyad: 'Kaya', user_phone: '5551112233',
  };

  it('pages across all field trainings and gives every item its trainingId', async () => {
    mockDb.rows['saha_training_applications as a'] = [appRow];
    mockDb.counted['saha_training_applications as a'] = [{ total: '41' }];

    const res = await service.adminListAllSahaApplications({ page: 3, pageSize: 20 });

    expect(res).toMatchObject({ total: 41, page: 3, pageSize: 20 });
    expect(res.items).toEqual([{
      trainingId: 's1', applicationId: 'a1', status: 'approved', attendance: 'katildi',
      attendanceAt: '2026-10-01T09:00:00.000Z', kkdDelivered: true, createdAt: '2026-09-01T09:00:00.000Z',
      user: { userId: 'u1', ad: 'Ali', soyad: 'Kaya', phone: '5551112233' },
    }]);
    const rowsQuery = mockDb.chains.find((c) => c.calls.some(([m]) => m === 'limit'));
    expect(rowsQuery.calls).toEqual(expect.arrayContaining([['limit', 20], ['offset', 40]]));
  });

  it('applies the status filter to both the count and the page', async () => {
    mockDb.counted['saha_training_applications as a'] = [{ total: 0 }];

    await service.adminListAllSahaApplications({ status: 'rejected', page: 1, pageSize: 20 });

    const countQuery = mockDb.chains.find((c) => c.counting);
    const rowsQuery = mockDb.chains.find((c) => c.calls.some(([m]) => m === 'limit'));
    expect(countQuery.calls).toContainEqual(['where', 'a.status', 'rejected']);
    expect(rowsQuery.calls).toContainEqual(['where', 'a.status', 'rejected']);
  });

  it('the per-training list returns the same item shape', async () => {
    mockDb.first.saha_trainings = { id: 's1', title: 'S', start_date: '2030-01-01' };
    mockDb.rows['saha_training_applications as a'] = [appRow];

    const perTraining = await service.adminListSahaApplications('s1');
    mockDb.counted['saha_training_applications as a'] = [{ total: 1 }];
    const bulk = await service.adminListAllSahaApplications({});

    expect(perTraining.items).toEqual(bulk.items);
    expect(bulk).toMatchObject({ page: 1, pageSize: 20 });
  });
});
