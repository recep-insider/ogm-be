'use strict';

jest.mock('bcrypt', () => require('../modules/admin/panel-fakes').fakeBcrypt);
jest.mock('../../src/config/db', () => ({ db: require('../modules/admin/panel-fakes').createFakeDb() }));
jest.mock('../../src/config/redis', () => ({ redis: require('../modules/admin/panel-fakes').createFakeRedis() }));

const { redis } = require('../../src/config/redis');
const { signAccessToken, signRegistrationToken, userBlockKey } = require('../../src/shared/jwt');
const { requireAuth, optionalAuth, requireAuthOrRegistration } = require('../../src/middlewares/auth');

function run(mw, token) {
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {} };
  return new Promise((resolve) => {
    mw(req, {}, (err) => resolve({ err, req }));
  });
}

beforeEach(() => redis.store.clear());

describe('middlewares/auth — silinen hesabın token engeli', () => {
  const token = () => signAccessToken({ sub: 'u1' });

  it('engel yokken requireAuth kullanıcıyı geçirir', async () => {
    const { err, req } = await run(requireAuth, token());
    expect(err).toBeUndefined();
    expect(req.user.id).toBe('u1');
  });

  it('engelli kullanıcının token\'ı requireAuth ve requireAuthOrRegistration\'da 401', async () => {
    await redis.set(userBlockKey('u1'), '1', 'EX', 900);
    expect((await run(requireAuth, token())).err).toMatchObject({ status: 401 });
    expect((await run(requireAuthOrRegistration, token())).err).toMatchObject({ status: 401 });
  });

  it('engelli kullanıcı optionalAuth\'ta misafir sayılır', async () => {
    await redis.set(userBlockKey('u1'), '1', 'EX', 900);
    const { err, req } = await run(optionalAuth, token());
    expect(err).toBeUndefined();
    expect(req.user).toBeUndefined();
  });

  it('Redis hatasında istek geçer (gönüllü SOS ve ihbarı kesintide de işlenir)', async () => {
    const get = jest.spyOn(redis, 'get').mockRejectedValue(new Error('Connection is closed'));
    const { err, req } = await run(requireAuth, token());
    expect(err).toBeUndefined();
    expect(req.user.id).toBe('u1');
    get.mockRestore();
  });

  it('kayıt token\'ı requireAuthOrRegistration\'dan geçer', async () => {
    const { err, req } = await run(requireAuthOrRegistration, signRegistrationToken({ sub: null, phone: '+905551112233' }));
    expect(err).toBeUndefined();
    expect(req.registration.phone).toBe('+905551112233');
  });
});
