'use strict';

// Gerçek app.js üzerinden: /v1/admin/auth uçlarının requireAdmin dışında kaldığını,
// oturum/çerez kurallarını ve requireAdmin'in panel token'ıyla davranışını doğrular.

jest.mock('bcrypt', () => require('./panel-fakes').fakeBcrypt);
jest.mock('../../../src/config/db', () => ({ db: require('./panel-fakes').createFakeDb() }));
jest.mock('../../../src/config/redis', () => ({ redis: require('./panel-fakes').createFakeRedis() }));
// Genel IP limiti kendi testinde (test/middlewares/rate-limit.test.js); burada istek sayısı onu aşıyor.
jest.mock('../../../src/middlewares/rate-limit', () => ({ generalLimiter: (_req, _res, next) => next() }));

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const env = require('../../../src/config/env');
const { db } = require('../../../src/config/db');
const { redis } = require('../../../src/config/redis');
const { signAccessToken, signPanelAccessToken } = require('../../../src/shared/jwt');
const adminService = require('../../../src/modules/admin/admin.service');
const missionsService = require('../../../src/modules/missions/missions.service');
const app = require('../../../src/app');

const PASSWORD = 'dogru-sifre-123';

function user(overrides = {}) {
  return {
    id: 'u-active',
    name: 'Ayşe Demir',
    email: 'ayse@ogm.gov.tr',
    bolge_mudurlugu: 'Antalya OBM',
    isletme_mudurlugu: 'Manavgat OİM',
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

let originalNodeEnv;
let originalOfficerKey;
beforeAll(() => {
  originalNodeEnv = env.nodeEnv;
  originalOfficerKey = env.admin.officerApiKey;
});
beforeEach(() => {
  env.nodeEnv = 'test';
  env.admin.officerApiKey = 'test-officer-key';
  seed();
});
afterAll(() => {
  env.nodeEnv = originalNodeEnv;
  env.admin.officerApiKey = originalOfficerKey;
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

  it('eşzamanlı hatalı denemeler de 5 ile sınırlanır', async () => {
    const bcrypt = require('bcrypt');
    const compare = bcrypt.compare;
    const spy = jest.spyOn(bcrypt, 'compare').mockImplementation(async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return compare(...args);
    });
    const results = await Promise.all(
      Array.from({ length: 8 }, () => login({ email: 'ayse@ogm.gov.tr', password: 'yanlis' })),
    );

    expect(results.filter((r) => r.status === 401)).toHaveLength(5);
    expect(results.filter((r) => r.status === 429)).toHaveLength(3);
    spy.mockRestore();
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

  it('çözülemeyen çerez değeri 500 değil 401 refresh_invalid döner', async () => {
    const res = await request(app).post('/v1/admin/auth/refresh').set('Cookie', 'ogm_panel_rt=%E0%A4%A');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('refresh_invalid');
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
    expect((await refresh(rotated)).body.error.code).toBe('refresh_invalid');
    expect(db.rows('panel_user_audit').map((a) => a.action)).toContain('auth.refresh_reused');
  });

  it('iptal edilmiş token süresi dolmuş olsa da tekrar kullanım sayılır', async () => {
    const first = await loggedInCookie();
    await refresh(first);
    db.rows('panel_refresh_tokens')[0].expires_at = new Date(Date.now() - 1000);

    expect((await refresh(first)).body.error.code).toBe('refresh_reused');
    expect(db.rows('panel_refresh_tokens').every((r) => r.revoked_at instanceof Date)).toBe(true);
  });

  it('şifre değişimiyle kapanan token 401 refresh_invalid döner, korunan oturumu düşürmez', async () => {
    const first = await loggedInCookie();
    const kept = await login();
    const changed = await request(app)
      .put('/v1/admin/auth/password')
      .set('Authorization', `Bearer ${kept.body.accessToken}`)
      .set('Cookie', `ogm_panel_rt=${cookieValue(refreshCookie(kept))}`)
      .send({ currentPassword: PASSWORD, newPassword: 'yeni-sifre-456' });
    expect(changed.status).toBe(204);

    const res = await refresh(first);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('refresh_invalid');
    expect(db.rows('panel_user_audit').map((a) => a.action)).not.toContain('auth.refresh_reused');
    expect((await refresh(cookieValue(refreshCookie(kept)))).status).toBe(200);
  });

  it('çıkışla kapanan token 401 refresh_invalid döner', async () => {
    const token = await loggedInCookie();
    await request(app).post('/v1/admin/auth/logout').set('Cookie', `ogm_panel_rt=${token}`);

    expect((await refresh(token)).body.error.code).toBe('refresh_invalid');
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
      bolge: 'Antalya OBM',
      isletme: 'Manavgat OİM',
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

  it('refresh çerezi yoksa kullanıcının tüm oturumlarını kapatır', async () => {
    const first = await session();
    await session();

    const res = await request(app)
      .put('/v1/admin/auth/password')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: 'yeni-sifre-456' });

    expect(res.status).toBe(204);
    const tokens = db.rows('panel_refresh_tokens');
    expect(tokens).toHaveLength(2);
    expect(tokens.every((t) => t.revoked_at instanceof Date)).toBe(true);
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
    ['72 bayttan uzun (çok baytlı)', 'ş'.repeat(40)],
  ])('yeni şifre %s ise 400', async (_label, newPassword) => {
    const res = await change(await session(), { currentPassword: PASSWORD, newPassword });

    expect(res.status).toBe(400);
    expect(res.body.error.details.errors[0].field).toBe('newPassword');
  });
});

describe('requireAdmin — panel token', () => {
  it('x-api-key artık admin uçlarına girmez (saha amiri anahtarı da)', async () => {
    expect((await adminPing({ 'x-api-key': 'herhangi-bir-anahtar' })).status).toBe(403);
    expect((await adminPing({ 'x-api-key': 'test-officer-key' })).status).toBe(403);
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

  it('requireOfficer saha amiri anahtarını kabul eder, başka anahtarı reddeder', async () => {
    const scan = (key) => request(app).post('/v1/missions/active/m1/scan').set('x-api-key', key).send({});
    expect((await scan('test-officer-key')).status).toBe(400);
    expect((await scan('eski-admin-anahtari')).status).toBe(403);
  });

  it('requireOfficer anahtar tanımsızken boş ya da eksik x-api-key\'i reddeder', async () => {
    env.admin.officerApiKey = '';
    const url = '/v1/missions/active/m1/scan';
    expect((await request(app).post(url).set('x-api-key', '').send({})).status).toBe(403);
    expect((await request(app).post(url).send({})).status).toBe(403);
  });

  it('yetki rolü token\'dan değil veritabanından okunur', async () => {
    const token = signPanelAccessToken({ sub: 'u-active', role: 'super_admin' });
    db.rows('panel_users')[0].role = 'admin';
    const res = await request(app).get('/v1/admin/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.body.role).toBe('admin');
  });
});

describe('admin işlem bağlamı (actorFrom)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('panel token\'ında ad x-operator-name başlığından değil panel_users kaydından alınır', async () => {
    const spy = jest.spyOn(adminService, 'getVolunteer').mockResolvedValue({ user: null, application: null });
    const { accessToken } = (await login()).body;

    const res = await request(app)
      .get('/v1/admin/volunteers/v1')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('x-operator-name', 'Baska');

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith('v1', expect.objectContaining({ name: 'Ayşe Demir' }));
  });

  it('QR okutmada panel kullanıcısının adı kaydedilir', async () => {
    const spy = jest.spyOn(missionsService, 'scan').mockResolvedValue({ ok: true });
    const { accessToken } = (await login()).body;

    const res = await request(app)
      .post('/v1/missions/active/m1/scan')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ userId: 'v1' });

    expect(res.status).toBeLessThan(300);
    expect(spy).toHaveBeenCalledWith('m1', expect.anything(), expect.objectContaining({ name: 'Ayşe Demir' }));
  });
});
