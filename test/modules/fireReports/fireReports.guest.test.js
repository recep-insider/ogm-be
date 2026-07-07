'use strict';

// Guest (token'sız) yangın ihbarı — kontrat 9.1 "üye olmadan devam" senaryosu:
// user_id NULL yazılır, anonymous=true olur, rate limit IP üzerinden işler.

const inserted = [];

jest.mock('../../../src/config/db', () => {
  const chain = {
    insert: jest.fn(async (row) => {
      inserted.push(row);
      return [1];
    }),
    where: jest.fn(() => chain),
    first: jest.fn(async () => ({
      id: inserted[inserted.length - 1].id,
      ...inserted[inserted.length - 1],
      created_at: new Date('2026-07-07T10:00:00Z'),
    })),
  };
  const db = Object.assign(jest.fn(() => chain), { raw: jest.fn() });
  return { db, __chain: chain };
});
jest.mock('../../../src/config/redis', () => ({
  redis: { incr: jest.fn(async () => 1), expire: jest.fn(async () => 1) },
}));
jest.mock('../../../src/config/env', () => ({
  geo: {},
  upload: { dir: '/tmp' },
  api: { baseUrl: 'https://api.test' },
}));
jest.mock('../../../src/config/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/shared/push-provider', () => ({ sendPushToUser: jest.fn() }));
jest.mock('../../../src/shared/asset-url', () => ({
  assetUrl: (rel) => (rel ? `https://cdn.test/${rel}` : null),
}));

const { redis } = require('../../../src/config/redis');
const service = require('../../../src/modules/fireReports/fireReports.service');

const files = [{ path: '/tmp/reports/x.jpg' }];
const data = { coordinates: { lat: 36.85, lng: 28.27 }, needs: [], description: 'Duman' };

describe('fireReports.service.create — guest (userId=null)', () => {
  beforeEach(() => {
    inserted.length = 0;
    jest.clearAllMocks();
  });

  test('user_id NULL + anonymous=true yazar, rate limit anahtarı IP bazlıdır', async () => {
    const result = await service.create({
      userId: null,
      data,
      files,
      ip: '1.2.3.4',
      userAgent: 'jest',
    });

    expect(result.ok).toBe(true);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].user_id).toBeNull();
    expect(inserted[0].anonymous).toBe(true);
    expect(redis.incr).toHaveBeenCalledWith('rl:fire:ip:1.2.3.4');
  });

  test('üye gönderiminde davranış değişmez: user_id set, anonymous=false, key userId bazlı', async () => {
    await service.create({ userId: 'u1', data, files, ip: '1.2.3.4', userAgent: 'jest' });

    expect(inserted[0].user_id).toBe('u1');
    expect(inserted[0].anonymous).toBe(false);
    expect(redis.incr).toHaveBeenCalledWith('rl:fire:u1');
  });
});
