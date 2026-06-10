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

  test('koltuk hesabı seatInfo kuralıyla aynı: pending + approved işgal eder', async () => {
    mockQueue.push([
      {
        id: 'ft1', title: 'Antalya Saha', location: 'Antalya Kampı',
        start_date: '2026-06-15', start_time: '09:00', end_time: '17:00',
        instructor_name: 'Kpt. Mert Tan', instructor_avatar_path: null, cover_path: null,
        total_seats: 30, is_active: 1,
        pending_count: '3', approved_count: '25', rejected_count: '2',
        created_at: new Date('2026-05-20T08:00:00Z'),
      },
    ]);

    const result = await adminListSaha({});

    expect(result.items[0]).toMatchObject({
      id: 'ft1', startDate: '2026-06-15', instructorName: 'Kpt. Mert Tan',
      totalSeats: 30, availableSeats: 2, // 30 - (3+25)
      applications: { pending: 3, approved: 25, rejected: 2 },
      isActive: true,
    });
  });

  test('availableSeats negatife düşmez (aşırı başvuru)', async () => {
    mockQueue.push([
      {
        id: 'ft2', title: 'Dolu Eğitim', location: 'X', start_date: '2026-07-01',
        start_time: '09:00', end_time: '17:00', instructor_name: 'Y',
        total_seats: 10, is_active: 1,
        pending_count: '8', approved_count: '5', rejected_count: '0',
        created_at: null,
      },
    ]);

    const result = await adminListSaha({});
    expect(result.items[0].availableSeats).toBe(0);
  });
});
