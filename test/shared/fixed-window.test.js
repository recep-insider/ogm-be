'use strict';

const { createFakeRedis } = require('../modules/admin/panel-fakes');
const { hitFixedWindow } = require('../../src/shared/fixed-window');

const opts = { max: 2, windowSec: 60, message: 'Limit' };

describe('hitFixedWindow', () => {
  test('INCR + EXPIRE NX tek MULTI içinde gider', async () => {
    const redis = createFakeRedis();
    const calls = [];
    const chain = {
      incr: (...a) => (calls.push(['incr', ...a]), chain),
      expire: (...a) => (calls.push(['expire', ...a]), chain),
      ttl: (...a) => (calls.push(['ttl', ...a]), chain),
      exec: async () => [[null, 1], [null, 1], [null, 60]],
    };
    redis.multi = () => chain;
    redis.incr = jest.fn();
    redis.expire = jest.fn();

    await hitFixedWindow(redis, 'k', opts);

    expect(calls).toEqual([['incr', 'k'], ['expire', 'k', 60, 'NX'], ['ttl', 'k']]);
    expect(redis.incr).not.toHaveBeenCalled();
    expect(redis.expire).not.toHaveBeenCalled();
  });

  test('sınır aşılınca 429 + retryAfterSec; özel kod verilebilir', async () => {
    const redis = createFakeRedis();
    await hitFixedWindow(redis, 'k', opts);
    await hitFixedWindow(redis, 'k', opts);

    await expect(hitFixedWindow(redis, 'k', opts)).rejects.toMatchObject({
      status: 429, code: 'rate_limited', details: { retryAfterSec: 60 },
    });
    await expect(hitFixedWindow(redis, 'k', { ...opts, code: 'sms_daily_limit' })).rejects.toMatchObject({
      code: 'sms_daily_limit',
    });
  });

  test("TTL'siz kalmış eski sayaca TTL verilir, mevcut TTL uzatılmaz", async () => {
    const redis = createFakeRedis();
    redis.store.set('legacy', { value: 1, expiresAt: null });
    redis.store.set('live', { value: 1, expiresAt: Date.now() + 10_000 });

    await hitFixedWindow(redis, 'legacy', opts);
    await hitFixedWindow(redis, 'live', opts);

    expect(await redis.ttl('legacy')).toBe(60);
    expect(await redis.ttl('live')).toBe(10);
  });

  test('MULTI içindeki komut hatası yutulmaz', async () => {
    const redis = createFakeRedis();
    const boom = new Error('ERR wrong number of arguments');
    const chain = { incr: () => chain, expire: () => chain, ttl: () => chain, exec: async () => [[null, 1], [boom, null], [null, -1]] };
    redis.multi = () => chain;

    await expect(hitFixedWindow(redis, 'k', opts)).rejects.toBe(boom);
  });
});
