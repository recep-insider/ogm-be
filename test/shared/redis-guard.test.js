'use strict';

jest.mock('../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const { AppError } = require('../../src/shared/errors');
const { guardRedis, guardedClient } = require('../../src/shared/redis-guard');
const { createFakeRedis } = require('../modules/admin/panel-fakes');

describe('guardRedis (BUG-024)', () => {
  it('çalışan Redis\'te sonucu aynen döner', async () => {
    const redis = createFakeRedis();
    await redis.set('k', 'v');
    expect(await guardedClient(redis).get('k')).toBe('v');
  });

  it.each([['close'], ['reconnecting'], ['end']])('bağlantı %s iken komut gönderilmeden 503', async (status) => {
    const redis = createFakeRedis();
    redis.status = status;
    const get = jest.spyOn(redis, 'get');

    await expect(guardedClient(redis).get('k')).rejects.toMatchObject({ status: 503, code: 'service_unavailable' });
    expect(get).not.toHaveBeenCalled();
  });

  it('Redis hatası "kayıt yok" sayılmaz, 503 olur (PA-41555)', async () => {
    const redis = createFakeRedis();
    redis.get = jest.fn(async () => { throw new Error('Connection is closed.'); });
    await expect(guardedClient(redis).get('k')).rejects.toMatchObject({ status: 503 });
  });

  it('uygulama hatası (AppError) olduğu gibi geçer', async () => {
    const redis = createFakeRedis();
    const own = new AppError('çok sık', { status: 429, code: 'rate_limited' });
    await expect(guardRedis(redis, async () => { throw own; })).rejects.toBe(own);
  });
});
