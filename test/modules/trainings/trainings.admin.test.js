'use strict';

// adminListOnline/adminListSaha için zincirlenebilir knex mock'u (admin-read deseni).
const mockQueue = [];

jest.mock('../../../src/config/db', () => {
  const makeChain = () => {
    const chain = {};
    const passthrough = ['where', 'select', 'orderBy', 'whereIn', 'count', 'pluck'];
    for (const method of passthrough) {
      chain[method] = jest.fn(() => chain);
    }
    chain.first = jest.fn(() => Promise.resolve(mockQueue.shift()));
    chain.then = (resolve, reject) => Promise.resolve(mockQueue.shift()).then(resolve, reject);
    return chain;
  };
  const dbFn = jest.fn(() => makeChain());
  dbFn.raw = jest.fn((sql) => ({ __raw: sql }));
  return { db: dbFn };
});
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/shared/asset-url', () => ({
  assetUrl: (rel) => (rel ? `https://cdn.test/${rel}` : null),
}));

const { adminListOnline, adminListSaha } = require('../../../src/modules/trainings/trainings.service');

describe('trainings.service — adminListOnline', () => {
  beforeEach(() => { mockQueue.length = 0; });

  test('exposes the raw face-to-face session fields for panel roundtrip', async () => {
    mockQueue.push([
      {
        id: 't2', title: 'Yüz Yüze Temel', duration_min: 120, delivery: 'yuzyuze', is_active: 1,
        session_starts_at: new Date('2026-10-01T07:00:00Z'), session_location: 'Salon A',
        session_instructor: 'Ayşe Demir', enrolled: 0, completed: 0,
      },
      { id: 't3', title: 'Online', duration_min: 30, delivery: 'online', is_active: 1 },
    ]);

    const { items } = await adminListOnline({});

    expect(items[0]).toMatchObject({
      startsAt: '2026-10-01T07:00:00.000Z', location: 'Salon A', instructor: 'Ayşe Demir',
    });
    expect(items[1]).toMatchObject({ startsAt: null, location: null, instructor: null });
  });

  test('aggregate sayaçları Number\'a çevirip panel sözleşmesine mapler', async () => {
    mockQueue.push([
      {
        id: 't1', title: 'Temel Eğitim', description: 'Açıklama', duration_min: 90,
        icon_tone: 'primary', sort_order: 1, video_path: 'videos/t1.mp4', is_active: 1,
        enrolled: '12', completed: '7', created_at: new Date('2026-05-20T08:00:00Z'),
      },
    ]);

    const result = await adminListOnline({});

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: 't1', title: 'Temel Eğitim', durationMin: 90,
      videoUrl: 'https://cdn.test/videos/t1.mp4', isActive: true,
      enrolled: 12, completed: 7,
    });
  });
});

describe('trainings.service — adminListSaha', () => {
  beforeEach(() => { mockQueue.length = 0; });

  test('sayaç ayrışır: Kayıtlı N/kontenjan · Katılan N (yedek kavramı yok)', async () => {
    mockQueue.push([
      {
        id: 'ft1', title: 'Antalya Saha', location: 'Antalya Kampı',
        start_date: '2026-06-15', start_time: '09:00', end_time: '17:00',
        instructor_name: 'Kpt. Mert Tan', instructor_avatar_path: null, cover_path: null,
        total_seats: 30, is_active: 1, grants_competency: 1,
        enrolled_count: '28', attended_count: '24',
        created_at: new Date('2026-05-20T08:00:00Z'),
      },
    ]);

    const result = await adminListSaha({});

    expect(result.items[0]).toMatchObject({
      id: 'ft1', startDate: '2026-06-15', instructorName: 'Kpt. Mert Tan',
      totalSeats: 30, availableSeats: 2, // 30 - 28 kayıtlı
      enrolled: 28, attended: 24, grantsCompetency: true,
      isActive: true,
    });
  });

  test('availableSeats negatife düşmez — kontenjan aşımı engel değil, yalnızca bilgi', async () => {
    mockQueue.push([
      {
        id: 'ft2', title: 'Dolu Eğitim', location: 'X', start_date: '2026-07-01',
        start_time: '09:00', end_time: '17:00', instructor_name: 'Y',
        total_seats: 10, is_active: 1,
        enrolled_count: '13', attended_count: '5',
        created_at: null,
      },
    ]);

    const result = await adminListSaha({});
    expect(result.items[0].availableSeats).toBe(0);
  });

  test('the enrolled count leaves rejected applications out, so they hold no seat', async () => {
    const { db } = require('../../../src/config/db');
    mockQueue.push([]);

    await adminListSaha({});

    const enrolledSql = db.raw.mock.calls
      .map(([sql]) => sql)
      .find((sql) => sql.includes('as enrolled_count'));
    expect(enrolledSql).toMatch(/status <> 'rejected'/);
  });
});
