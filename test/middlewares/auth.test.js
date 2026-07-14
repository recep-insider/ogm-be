'use strict';

// Auth guard'ları için birim testler. redis mock'lanır (config/redis → logger dosya
// sistemine dokunmasın diye — repo deseni: bağımlılıkları unit seviyede mock'la).
// Token'lar gerçek shared/jwt ile imzalanır; böylece verify tarafı da gerçek çalışır.

process.env.ADMIN_API_KEY = 'test-admin-key';
process.env.OFFICER_API_KEY = 'test-officer-key';

jest.mock('../../src/config/redis', () => ({
  redis: { get: jest.fn() },
}));

const { signAccessToken, signRegistrationToken } = require('../../src/shared/jwt');
const {
  requireAuth,
  requireAdminAuth,
  requireAdmin,
} = require('../../src/middlewares/auth');

// next(err) toplayan minimal harness
function run(mw, req) {
  return new Promise((resolve) => {
    const res = {};
    mw(req, res, (err) => resolve(err));
  });
}

describe('middlewares/auth — requireAdminAuth (admin realm guard)', () => {
  test('token yoksa 401 döner', async () => {
    const err = await run(requireAdminAuth, { headers: {} });
    expect(err).toMatchObject({ status: 401 });
  });

  test('geçersiz/çöp token 401 döner', async () => {
    const err = await run(requireAdminAuth, {
      headers: { authorization: 'Bearer not-a-real-jwt' },
    });
    expect(err).toMatchObject({ status: 401 });
  });

  test("atyp!=='admin' olan (gönüllü) access token 403 döner", async () => {
    // Gönüllü access token'ında atyp claim'i yoktur.
    const volunteerToken = signAccessToken({ sub: 'user-1' });
    const err = await run(requireAdminAuth, {
      headers: { authorization: `Bearer ${volunteerToken}` },
    });
    expect(err).toMatchObject({ status: 403 });
  });

  test('geçerli admin token: req.user set edilir ve next() hatasız çağrılır', async () => {
    const adminToken = signAccessToken({ sub: 'adm-1', atyp: 'admin', role: 'admin' });
    const req = { headers: { authorization: `Bearer ${adminToken}` } };
    const err = await run(requireAdminAuth, req);
    expect(err).toBeUndefined();
    expect(req.user).toMatchObject({ id: 'adm-1', atyp: 'admin' });
    expect(req.token).toBe(adminToken);
  });

  test('registration token (yanlış typ) 401 döner', async () => {
    const regToken = signRegistrationToken({ sub: 'user-1', atyp: 'admin' });
    const err = await run(requireAdminAuth, {
      headers: { authorization: `Bearer ${regToken}` },
    });
    expect(err).toMatchObject({ status: 401 });
  });
});

describe('middlewares/auth — requireAuth', () => {
  test('token yoksa 401', async () => {
    const err = await run(requireAuth, { headers: {} });
    expect(err).toMatchObject({ status: 401 });
  });

  test('geçerli access token: req.user.id set edilir, next() hatasız', async () => {
    const token = signAccessToken({ sub: 'user-9' });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const err = await run(requireAuth, req);
    expect(err).toBeUndefined();
    expect(req.user.id).toBe('user-9');
  });

  test('geçersiz token 401', async () => {
    const err = await run(requireAuth, { headers: { authorization: 'Bearer x.y.z' } });
    expect(err).toMatchObject({ status: 401 });
  });

  test('Bearer olmayan şema (Basic) yok sayılır → 401', async () => {
    const err = await run(requireAuth, { headers: { authorization: 'Basic abc' } });
    expect(err).toMatchObject({ status: 401 });
  });
});

describe('middlewares/auth — requireAdmin (apiKeyOrRole)', () => {
  test('geçerli x-api-key: req.actor api_key olur, next() hatasız', async () => {
    const req = { headers: { 'x-api-key': 'test-admin-key' } };
    const err = await run(requireAdmin, req);
    expect(err).toBeUndefined();
    expect(req.actor).toMatchObject({ type: 'api_key', role: 'admin' });
  });

  test("role='admin' token: req.user set edilir, next() hatasız", async () => {
    const token = signAccessToken({ sub: 'adm-2', role: 'admin' });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const err = await run(requireAdmin, req);
    expect(err).toBeUndefined();
    expect(req.user.id).toBe('adm-2');
    expect(req.actor).toMatchObject({ type: 'token', role: 'admin' });
  });

  test("role='officer' token admin ucunda 403 alır", async () => {
    const token = signAccessToken({ sub: 'off-1', role: 'officer' });
    const err = await run(requireAdmin, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(err).toMatchObject({ status: 403 });
  });

  test('kimlik yoksa 403', async () => {
    const err = await run(requireAdmin, { headers: {} });
    expect(err).toMatchObject({ status: 403 });
  });

  test('yanlış x-api-key 403', async () => {
    const err = await run(requireAdmin, { headers: { 'x-api-key': 'wrong' } });
    expect(err).toMatchObject({ status: 403 });
  });
});
