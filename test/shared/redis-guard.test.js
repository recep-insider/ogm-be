'use strict';

jest.mock('../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const { AppError } = require('../../src/shared/errors');
const { guardRedis, guardedClient, delVerifiedSession } = require('../../src/shared/redis-guard');
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

  it('yanıt gecikirse 503 komutun uygulanmış olabileceğini işaretler', async () => {
    const redis = createFakeRedis();
    const err = await guardRedis(redis, () => new Promise(() => {}), 10).catch((e) => e);
    expect(err).toMatchObject({ status: 503, code: 'service_unavailable', maybeApplied: true });
  });

  it('hemen dönen Redis hatası uygulanmamış sayılır', async () => {
    const redis = createFakeRedis();
    const err = await guardRedis(redis, async () => { throw new Error('Connection is closed.'); }).catch((e) => e);
    expect(err.maybeApplied).toBeUndefined();
  });
});

describe('delVerifiedSession', () => {
  it('uygulanmış olabilecek silmede akış sürer', async () => {
    const client = { del: jest.fn(async () => { throw Object.assign(new Error('x'), { maybeApplied: true }); }) };
    await expect(delVerifiedSession(client, 'k')).resolves.toBeUndefined();
  });

  it('uygulanmadığı belli silmede hata geçer', async () => {
    const own = new AppError('yok', { status: 503, code: 'service_unavailable' });
    const client = { del: jest.fn(async () => { throw own; }) };
    await expect(delVerifiedSession(client, 'k')).rejects.toBe(own);
  });
});
