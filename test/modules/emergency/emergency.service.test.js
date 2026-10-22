'use strict';

// Acil bildirim hız sınırı: kullanıcı başına dakikada 5, sayaç atomik ve TTL'li; Redis
// hatasında bildirim yazılmaz (hata çağırana döner).

const mockInserted = [];

jest.mock('../../../src/config/db', () => ({
  db: jest.fn(() => ({ insert: jest.fn(async (row) => mockInserted.push(row)) })),
}));
jest.mock('../../../src/config/redis', () => ({ redis: require('../admin/panel-fakes').createFakeRedis() }));
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));

const { redis } = require('../../../src/config/redis');
const service = require('../../../src/modules/emergency/emergency.service');

const send = () => service.create({ userId: 'u1', body: {}, ip: '1.2.3.4', userAgent: 'jest' });

beforeEach(() => {
  mockInserted.length = 0;
  redis.store.clear();
});

describe('emergency.service.create — hız sınırı', () => {
  test('6. bildirim 429 rate_limited; sayaç 60 sn TTL taşır', async () => {
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await send();
    }
    await expect(send()).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
    expect(await redis.ttl('rl:emergency:u1')).toBe(60);
    expect(mockInserted).toHaveLength(5);
  });

  test('Redis hatası çağırana döner, bildirim yazılmaz', async () => {
    const down = new Error('Connection is closed.');
    jest.spyOn(redis, 'multi').mockReturnValueOnce({
      incr() { return this; },
      expire() { return this; },
      ttl() { return this; },
      exec: async () => { throw down; },
    });

    await expect(send()).rejects.toBe(down);
    expect(mockInserted).toHaveLength(0);
  });
});
