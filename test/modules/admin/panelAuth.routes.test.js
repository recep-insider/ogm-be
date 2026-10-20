'use strict';

// Gerçek app.js üzerinden: /v1/admin/auth uçlarının requireAdmin dışında kaldığını,
// oturum/çerez kurallarını ve requireAdmin'in panel token'ıyla davranışını doğrular.

jest.mock('bcrypt', () => require('./panel-fakes').fakeBcrypt);
jest.mock('../../../src/config/db', () => ({ db: require('./panel-fakes').createFakeDb() }));
jest.mock('../../../src/config/redis', () => ({ redis: require('./panel-fakes').createFakeRedis() }));

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const env = require('../../../src/config/env');
const { db } = require('../../../src/config/db');
const { redis } = require('../../../src/config/redis');
const { signAccessToken, signPanelAccessToken } = require('../../../src/shared/jwt');
const app = require('../../../src/app');

const PASSWORD = 'dogru-sifre-123';

function user(overrides = {}) {
  return {
    id: 'u-active',
    name: 'Ayşe Demir',
    email: 'ayse@ogm.gov.tr',
    unit_id: 'unit-1',
    phone: '+905551112233',
    password_hash: `hash:${PASSWORD}`,
    role: 'admin',
    status: 'active',
    is_system: false,
    must_change_password: false,
    rejection_reason: null,
    last_login_at: null,
    ...overrides,
  };
}

function seed(users = [user()]) {
  db.reset({ panel_users: users, panel_refresh_tokens: [], panel_user_audit: [] });
  redis.store.clear();
}

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

function refreshCookie(res) {
  return (res.headers['set-cookie'] || []).find((c) => c.startsWith('ogm_panel_rt='));
}

function cookieValue(setCookie) {
  return decodeURIComponent(setCookie.split(';')[0].split('=')[1]);
}

function login(body = { email: 'ayse@ogm.gov.tr', password: PASSWORD }) {
  return request(app).post('/v1/admin/auth/login').send(body);
}

function adminPing(headers = {}) {
  return request(app).get('/v1/admin/regions').set(headers);
}

let originalApiKey;
let originalNodeEnv;
beforeAll(() => {
  originalApiKey = env.admin.apiKey;
  originalNodeEnv = env.nodeEnv;
});
beforeEach(() => {
  env.admin.apiKey = 'test-admin-key';
  env.nodeEnv = 'test';
  seed();
});
afterAll(() => {
  env.admin.apiKey = originalApiKey;
  env.nodeEnv = originalNodeEnv;
});

describe('POST /v1/admin/auth/login', () => {
  it('aktif kullanıcıya access token, kullanıcı ve refresh çerezi döner', async () => {
    const res = await login({ email: '  AYSE@ogm.gov.tr ', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.expiresIn).toBe(900);
    expect(res.body.user).toEqual({
      id: 'u-active',
      name: 'Ayşe Demir',
      email: 'ayse@ogm.gov.tr',
      role: 'admin',
      mustChangePassword: false,
    });
    expect(res.body).not.toHaveProperty('refreshToken');

    const stored = db.rows('panel_refresh_tokens');
    expect(stored).toHaveLength(1);
    expect(stored[0].token_hash).toBe(sha256(cookieValue(refreshCookie(res))));
    expect(db.rows('panel_users')[0].last_login_at).toBeInstanceOf(Date);
    expect(db.rows('panel_user_audit').map((a) => a.action)).toEqual(['auth.login']);
  });

  it('verilen access token yetkilendirmenin dayandığı tüm claim\'leri taşır (SIM-1072)', async () => {
    const res = await login();
    const claims = jwt.decode(res.body.accessToken);

    expect(claims).toMatchObject({
      sub: 'u-active',
      role: 'admin',
      typ: 'panel_access',
      aud: 'ogm-panel',
      iss: 'ogm-gonullu-api',
    });
    expect(claims.exp - claims.iat).toBe(900);
  });

  it('refresh çerezi httpOnly, SameSite=Strict, Path=/v1/admin/auth, 12 saat; test ortamında Secure değil', async () => {
    const cookie = refreshCookie(await login());

    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/v1\/admin\/auth/);
    expect(cookie).toMatch(/Max-Age=43200/);
    expect(cookie).not.toMatch(/Secure/);
  });

  it('production ortamında çerez Secure olur', async () => {
    env.nodeEnv = 'production';
    expect(refreshCookie(await login())).toMatch(/Secure/);
  });

  it.each([
    ['bilinmeyen e-posta', { email: 'yok@ogm.gov.tr', password: PASSWORD }],
    ['yanlış şifre', { email: 'ayse@ogm.gov.tr', password: 'yanlis' }],
  ])('%s → 401 invalid_credentials (aynı mesaj)', async (_label, body) => {
    const res = await login(body);

    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({ code: 'invalid_credentials', message: 'E-posta veya şifre hatalı.' });
    expect(refreshCookie(res)).toBeUndefined();
  });

  it.each([
    ['pending', 'account_pending', undefined],
    ['rejected', 'account_rejected', { reason: 'Kurum dışı e-posta' }],
    ['disabled', 'account_disabled', undefined],
  ])('doğru şifre + %s hesap → 403 %s', async (status, code, details) => {
    seed([user({ status, rejection_reason: status === 'rejected' ? 'Kurum dışı e-posta' : null })]);
    const res = await login();

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(code);
    expect(res.body.error.details).toEqual(details);
    expect(db.rows('panel_refresh_tokens')).toHaveLength(0);
  });

  it.each(['pending', 'rejected', 'disabled'])('yanlış şifre + %s hesap durumu sızdırmaz', async (status) => {
    seed([user({ status })]);
    const res = await login({ email: 'ayse@ogm.gov.tr', password: 'yanlis' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
  });

  it('e-posta + IP başına 5 hatadan sonra 429 rate_limited ve retryAfterSec döner', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await login({ email: 'ayse@ogm.gov.tr', password: 'yanlis' })).status).toBe(401);
    }
    const blocked = await login();

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('rate_limited');
    expect(blocked.body.error.details.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.body.error.details.retryAfterSec).toBeLessThanOrEqual(900);
  });

  it('kilit başka e-postayı etkilemez', async () => {
    seed([user(), user({ id: 'u-2', email: 'mehmet@ogm.gov.tr' })]);
    for (let i = 0; i < 5; i += 1) await login({ email: 'ayse@ogm.gov.tr', password: 'yanlis' });

    expect((await login({ email: 'mehmet@ogm.gov.tr', password: PASSWORD })).status).toBe(200);
  });

  it('başarılı giriş hata sayacını sıfırlar', async () => {
    for (let i = 0; i < 4; i += 1) await login({ email: 'ayse@ogm.gov.tr', password: 'yanlis' });
    expect((await login()).status).toBe(200);
    for (let i = 0; i < 4; i += 1) await login({ email: 'ayse@ogm.gov.tr', password: 'yanlis' });

    expect((await login()).status).toBe(200);
  });

  it('eksik alanlarda 400 döner', async () => {
    expect((await login({ email: 'ayse@ogm.gov.tr' })).status).toBe(400);
  });
});

describe('POST /v1/admin/auth/refresh', () => {
  async function loggedInCookie() {
    return cookieValue(refreshCookie(await login()));
  }

  const refresh = (token) => {
    const req = request(app).post('/v1/admin/auth/refresh');
    return token ? req.set('Cookie', `diger=1; ogm_panel_rt=${encodeURIComponent(token)}`) : req;
  };

  it('token\'ı döndürür: eskisi replaced_by ile iptal, yenisi 12 saat geçerli', async () => {
    const first = await loggedInCookie();
    const before = Date.now();
    const res = await refresh(first);

    expect(res.status).toBe(200);
    expect(jwt.decode(res.body.accessToken)).toMatchObject({ sub: 'u-active', typ: 'panel_access' });
    const second = cookieValue(refreshCookie(res));
    expect(second).not.toBe(first);

    const [oldRow, newRow] = db.rows('panel_refresh_tokens');
    expect(oldRow.revoked_at).toBeInstanceOf(Date);
    expect(oldRow.replaced_by).toBe(newRow.id);
    expect(newRow.token_hash).toBe(sha256(second));
    expect(newRow.revoked_at).toBeUndefined();
    expect(newRow.expires_at.getTime()).toBeGreaterThanOrEqual(before + 12 * 3600 * 1000);
  });

  it('çerez yoksa ya da bilinmiyorsa 401 refresh_invalid ve çerez silinir', async () => {
    const none = await refresh();
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe('refresh_invalid');

    const unknown = await refresh('uydurma');
    expect(unknown.body.error.code).toBe('refresh_invalid');
    expect(refreshCookie(unknown)).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('süresi dolmuş token 401 refresh_expired', async () => {
    const token = await loggedInCookie();
    db.rows('panel_refresh_tokens')[0].expires_at = new Date(Date.now() - 1000);

    const res = await refresh(token);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('refresh_expired');
  });

  it('iptal edilmiş token tekrar sunulursa kullanıcının TÜM token\'ları iptal edilir', async () => {
    const first = await loggedInCookie();
    await loggedInCookie();
    const rotated = cookieValue(refreshCookie(await refresh(first)));

    const res = await refresh(first);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('refresh_reused');
    expect(db.rows('panel_refresh_tokens').every((r) => r.revoked_at instanceof Date)).toBe(true);
    expect((await refresh(rotated)).body.error.code).toBe('refresh_reused');
    expect(db.rows('panel_user_audit').map((a) => a.action)).toContain('auth.refresh_reused');
  });

  it('iptal edilmiş token süresi dolmuş olsa da tekrar kullanım sayılır', async () => {
    const first = await loggedInCookie();
    await refresh(first);
    db.rows('panel_refresh_tokens')[0].expires_at = new Date(Date.now() - 1000);

    expect((await refresh(first)).body.error.code).toBe('refresh_reused');
    expect(db.rows('panel_refresh_tokens').every((r) => r.revoked_at instanceof Date)).toBe(true);
  });

  it('kullanıcı artık aktif değilse 403 ve oturumları kapatılır', async () => {
    const token = await loggedInCookie();
    db.rows('panel_users')[0].status = 'disabled';

    const res = await refresh(token);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('account_disabled');
    expect(db.rows('panel_refresh_tokens')[0].revoked_at).toBeInstanceOf(Date);
  });
});

describe('POST /v1/admin/auth/logout', () => {
  it('kişinin tüm oturumlarını kapatır, çerezi siler; tekrar çağrı da 204', async () => {
    const token = cookieValue(refreshCookie(await login()));
    const other = cookieValue(refreshCookie(await login()));

    const res = await request(app).post('/v1/admin/auth/logout').set('Cookie', `ogm_panel_rt=${token}`);
    expect(res.status).toBe(204);
    expect(refreshCookie(res)).toMatch(/Path=\/v1\/admin\/auth/);
    const [loggedOut, otherSession] = db.rows('panel_refresh_tokens');
    expect(loggedOut.token_hash).toBe(sha256(token));
    expect(loggedOut.revoked_at).toBeInstanceOf(Date);
    expect(otherSession.token_hash).toBe(sha256(other));
    expect(otherSession.revoked_at).toBeInstanceOf(Date);

    expect((await request(app).post('/v1/admin/auth/logout').set('Cookie', `ogm_panel_rt=${token}`)).status).toBe(204);
    expect((await request(app).post('/v1/admin/auth/logout')).status).toBe(204);
  });
});

describe('GET /v1/admin/auth/me', () => {
  it('panel kullanıcısının profilini döner', async () => {
    const { accessToken } = (await login()).body;
    const res = await request(app).get('/v1/admin/auth/me').set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: 'u-active',
      name: 'Ayşe Demir',
      email: 'ayse@ogm.gov.tr',
      role: 'admin',
      mustChangePassword: false,
      unitId: 'unit-1',
      phone: '+905551112233',
      lastLoginAt: expect.any(String),
    });
  });

  it('token yoksa ya da mobil token ise 401', async () => {
    expect((await request(app).get('/v1/admin/auth/me')).status).toBe(401);
    const mobile = signAccessToken({ sub: 'u-active', role: 'admin' });
    expect((await request(app).get('/v1/admin/auth/me').set('Authorization', `Bearer ${mobile}`)).status).toBe(401);
  });
});

describe('PUT /v1/admin/auth/password', () => {
  async function session() {
    const res = await login();
    return { accessToken: res.body.accessToken, cookie: cookieValue(refreshCookie(res)) };
  }

  const change = ({ accessToken, cookie }, body) =>
    request(app)
      .put('/v1/admin/auth/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', `ogm_panel_rt=${cookie}`)
      .send(body);

  it('şifreyi değiştirir, zorunluluğu kaldırır, diğer oturumları kapatır, bu oturumu korur', async () => {
    seed([user({ must_change_password: true })]);
    const other = await session();
    const current = await session();

    const res = await change(current, { currentPassword: PASSWORD, newPassword: 'yeni-sifre-456' });
    expect(res.status).toBe(204);

    const row = db.rows('panel_users')[0];
    expect(row.password_hash).toBe('hash:yeni-sifre-456');
    expect(row.must_change_password).toBe(false);
    const tokens = db.rows('panel_refresh_tokens');
    expect(tokens.find((t) => t.token_hash === sha256(other.cookie)).revoked_at).toBeInstanceOf(Date);
    expect(tokens.find((t) => t.token_hash === sha256(current.cookie)).revoked_at).toBeUndefined();
    expect(db.rows('panel_user_audit').map((a) => a.action)).toContain('auth.password_change');
  });

  it('mevcut şifre yanlışsa 401 invalid_credentials', async () => {
    const res = await change(await session(), { currentPassword: 'yanlis', newPassword: 'yeni-sifre-456' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
    expect(db.rows('panel_users')[0].password_hash).toBe(`hash:${PASSWORD}`);
  });

  it.each([
    ['8 karakterden kısa', 'kisa'],
    ['mevcut şifreyle aynı', PASSWORD],
  ])('yeni şifre %s ise 400', async (_label, newPassword) => {
    const res = await change(await session(), { currentPassword: PASSWORD, newPassword });

    expect(res.status).toBe(400);
    expect(res.body.error.details.errors[0].field).toBe('newPassword');
  });
});

describe('requireAdmin — panel token / x-api-key', () => {
  it('x-api-key bugünkü gibi çalışır', async () => {
    expect((await adminPing({ 'x-api-key': 'test-admin-key' })).status).toBe(200);
  });

  it('anahtar ve token yoksa 403 forbidden', async () => {
    const res = await adminPing();
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('aktif kullanıcının panel token\'ını kabul eder', async () => {
    const { accessToken } = (await login()).body;
    expect((await adminPing({ Authorization: `Bearer ${accessToken}` })).status).toBe(200);
  });

  it.each(['disabled', 'pending', 'rejected'])('%s kullanıcının (hâlâ geçerli) token\'ını reddeder', async (status) => {
    const { accessToken } = (await login()).body;
    db.rows('panel_users')[0].status = status;

    expect((await adminPing({ Authorization: `Bearer ${accessToken}` })).status).toBe(401);
  });

  it('must_change_password iken 403 password_change_required; /me yine çalışır', async () => {
    seed([user({ must_change_password: true })]);
    const { accessToken } = (await login()).body;

    const res = await adminPing({ Authorization: `Bearer ${accessToken}` });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('password_change_required');
    expect((await request(app).get('/v1/admin/auth/me').set('Authorization', `Bearer ${accessToken}`)).status).toBe(200);
  });

  it('role claim\'li mobil access token\'ı reddeder', async () => {
    const mobile = signAccessToken({ sub: 'u-active', role: 'admin' });
    expect((await adminPing({ Authorization: `Bearer ${mobile}` })).status).toBe(401);
  });

  it.each([
    ['role yok', { sub: 'u-active', typ: 'panel_access' }, { audience: 'ogm-panel' }],
    ['typ yok', { sub: 'u-active', role: 'admin' }, { audience: 'ogm-panel' }],
    ['aud yok', { sub: 'u-active', role: 'admin', typ: 'panel_access' }, {}],
    ['sub yok', { role: 'admin', typ: 'panel_access' }, { audience: 'ogm-panel' }],
    ['geçersiz role', { sub: 'u-active', role: 'officer', typ: 'panel_access' }, { audience: 'ogm-panel' }],
  ])('claim eksik panel token\'ını reddeder: %s', async (_label, payload, opts) => {
    const token = jwt.sign(payload, env.jwt.accessSecret, { issuer: 'ogm-gonullu-api', expiresIn: '5m', ...opts });
    expect((await adminPing({ Authorization: `Bearer ${token}` })).status).toBe(401);
  });

  it('requireOfficer (QR okutma) aktif panel token\'ını kabul eder, mobil token\'ı reddeder', async () => {
    const { accessToken } = (await login()).body;
    const scan = (token) =>
      request(app).post('/v1/missions/active/m1/scan').set('Authorization', `Bearer ${token}`).send({});

    expect((await scan(accessToken)).status).toBe(400);
    expect((await scan(signAccessToken({ sub: 'u-active', role: 'officer' }))).status).toBe(401);
  });

  it('yetki rolü token\'dan değil veritabanından okunur', async () => {
    const token = signPanelAccessToken({ sub: 'u-active', role: 'super_admin' });
    db.rows('panel_users')[0].role = 'admin';
    const res = await request(app).get('/v1/admin/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.body.role).toBe('admin');
  });
});
