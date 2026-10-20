'use strict';

// Gerçek app.js üzerinden: hesap talebi, birim listesi ve süper admin kullanıcı yönetimi.

jest.mock('bcrypt', () => require('./panel-fakes').fakeBcrypt);
jest.mock('../../../src/config/db', () => ({ db: require('./panel-fakes').createFakeDb() }));
jest.mock('../../../src/config/redis', () => ({ redis: require('./panel-fakes').createFakeRedis() }));
// Genel IP limiti kendi testinde (test/middlewares/rate-limit.test.js); burada istek sayısı onu aşıyor.
jest.mock('../../../src/middlewares/rate-limit', () => ({ generalLimiter: (_req, _res, next) => next() }));

const request = require('supertest');
const { db } = require('../../../src/config/db');
const { redis } = require('../../../src/config/redis');
const app = require('../../../src/app');
const service = require('../../../src/modules/admin/panelUsers/panelUsers.service');

const PASSWORD = 'dogru-sifre-123';

function panelUser(overrides = {}) {
  return {
    name: 'Kullanıcı',
    password_hash: `hash:${PASSWORD}`,
    role: 'admin',
    status: 'active',
    is_system: false,
    must_change_password: false,
    created_at: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

const SUPER = panelUser({ id: 'su-1', name: 'Sistem Yöneticisi', email: 'superadmin@ogm.gov.tr', role: 'super_admin', is_system: true });
const ADMIN = panelUser({ id: 'ad-1', name: 'Ayşe Demir', email: 'ayse@ogm.gov.tr', created_at: new Date('2026-10-02T00:00:00Z') });
const PENDING = panelUser({
  id: 'pe-1', name: 'İsmail Çelik', email: 'ismail@ogm.gov.tr', status: 'pending',
  bolge_mudurlugu: 'Antalya OBM', isletme_mudurlugu: 'Manavgat OİM', request_note: 'Saha koordinasyonu',
  requested_at: new Date('2026-10-03T00:00:00Z'), created_at: new Date('2026-10-03T00:00:00Z'),
});

function seed(users = [SUPER, ADMIN, PENDING]) {
  db.reset({
    panel_users: users,
    panel_refresh_tokens: [],
    panel_user_audit: [],
    forest_units: [
      { id: 'f1', il: 'Antalya', ilce: 'Manavgat', bolge_mudurlugu: 'Antalya OBM', isletme_mudurlugu: 'Manavgat OİM' },
      { id: 'f2', il: 'Antalya', ilce: 'Side', bolge_mudurlugu: 'Antalya OBM', isletme_mudurlugu: 'Manavgat OİM' },
      { id: 'f3', il: 'Antalya', ilce: 'Alanya', bolge_mudurlugu: 'Antalya OBM', isletme_mudurlugu: 'Alanya OİM' },
      { id: 'f4', il: 'Muğla', ilce: 'Marmaris', bolge_mudurlugu: 'Muğla OBM', isletme_mudurlugu: 'Marmaris OİM' },
      { id: 'f5', il: 'Çanakkale', ilce: 'Gelibolu', bolge_mudurlugu: 'Çanakkale OBM', isletme_mudurlugu: 'Gelibolu OİM' },
    ],
  });
  redis.store.clear();
}

beforeEach(() => seed());

async function tokenFor(email, password = PASSWORD) {
  const res = await request(app).post('/v1/admin/auth/login').send({ email, password });
  return res.body.accessToken;
}

const as = (token) => ({ Authorization: `Bearer ${token}` });
const row = (id) => db.rows('panel_users').find((u) => u.id === id);
const actions = () => db.rows('panel_user_audit').map((a) => a.action);

describe('GET /v1/admin/auth/units', () => {
  it('oturumsuz döner; bölge ve işletmeler tekil ve Türkçe sıralı', async () => {
    const res = await request(app).get('/v1/admin/auth/units');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      { bolge: 'Antalya OBM', isletmeler: ['Alanya OİM', 'Manavgat OİM'] },
      { bolge: 'Çanakkale OBM', isletmeler: ['Gelibolu OİM'] },
      { bolge: 'Muğla OBM', isletmeler: ['Marmaris OİM'] },
    ]);
  });
});

describe('POST /v1/admin/auth/request', () => {
  const body = (overrides = {}) => ({
    name: 'Elif Kaya',
    email: ' Elif@OGM.gov.tr ',
    password: 'elif-sifre-123',
    bolge: 'Muğla OBM',
    isletme: 'Marmaris OİM',
    phone: '+905321112233',
    note: 'Yangın sezonu için erişim',
    ...overrides,
  });
  const submit = (b) => request(app).post('/v1/admin/auth/request').send(b);

  it('pending kayıt açar, şifreyi özetler, denetime yazar; giriş onay bekler', async () => {
    const res = await submit(body());
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'pending' });

    const created = db.rows('panel_users').find((u) => u.email === 'elif@ogm.gov.tr');
    expect(created).toMatchObject({
      name: 'Elif Kaya', role: 'admin', status: 'pending', password_hash: 'hash:elif-sifre-123',
      bolge_mudurlugu: 'Muğla OBM', isletme_mudurlugu: 'Marmaris OİM', request_note: 'Yangın sezonu için erişim',
    });
    expect(created.requested_at).toBeInstanceOf(Date);
    expect(actions()).toContain('request.create');

    const login = await request(app).post('/v1/admin/auth/login').send({ email: 'elif@ogm.gov.tr', password: 'elif-sifre-123' });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('account_pending');
  });

  it.each([
    ['aktif hesap', ADMIN.email, 'email_taken'],
    ['bekleyen talep', PENDING.email, 'request_pending'],
  ])('%s varsa 409', async (_label, email, code) => {
    const res = await submit(body({ email }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(code);
  });

  it('pasif hesap da 409 email_taken', async () => {
    seed([SUPER, { ...ADMIN, status: 'disabled' }]);
    expect((await submit(body({ email: ADMIN.email }))).body.error.code).toBe('email_taken');
  });

  it('reddedilen e-posta yeni bilgilerle tekrar pending olur, eski gerekçe silinir', async () => {
    seed([SUPER, { ...PENDING, status: 'rejected', rejection_reason: 'Birim doğrulanamadı', approved_by: 'su-1' }]);
    const res = await submit(body({ email: PENDING.email, name: 'İsmail Çelik', note: '' }));

    expect(res.status).toBe(202);
    expect(row('pe-1')).toMatchObject({
      status: 'pending', rejection_reason: null, approved_by: null,
      bolge_mudurlugu: 'Muğla OBM', password_hash: 'hash:elif-sifre-123', request_note: null,
    });
    expect(actions()).toContain('request.resubmit');
  });

  it('bölge/işletme çifti forest_units\'te yoksa 400 unit_invalid', async () => {
    const res = await submit(body({ isletme: 'Manavgat OİM' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('unit_invalid');
    expect(db.rows('panel_users')).toHaveLength(3);
  });

  it.each([
    ['kısa şifre', { password: 'kisa' }],
    ['72 bayttan uzun şifre', { password: 'ş'.repeat(40) }],
    ['geçersiz e-posta', { email: 'eposta-degil' }],
    ['eksik birim', { bolge: undefined }],
  ])('%s 400 validation_error', async (_label, overrides) => {
    const res = await submit(body(overrides));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('IP başına saatte 10 talepten sonra 429 rate_limited', async () => {
    for (let i = 0; i < 10; i += 1) {
      expect((await submit(body({ email: `kisi${i}@ogm.gov.tr` }))).status).toBe(202);
    }
    const blocked = await submit(body({ email: 'kisi10@ogm.gov.tr' }));
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.details.retryAfterSec).toBeGreaterThan(0);
  });
});

describe('/v1/admin/panel-users yetkisi', () => {
  it('oturumsuz 403, admin rolü 403 super_admin_required', async () => {
    expect((await request(app).get('/v1/admin/panel-users')).status).toBe(403);
    const res = await request(app).get('/v1/admin/panel-users').set(as(await tokenFor(ADMIN.email)));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('super_admin_required');
  });

  it('şifresini değiştirmesi gereken süper admin 403 password_change_required', async () => {
    seed([{ ...SUPER, must_change_password: true }]);
    const res = await request(app).get('/v1/admin/panel-users').set(as(await tokenFor(SUPER.email)));
    expect(res.body.error.code).toBe('password_change_required');
  });

  it('rol veritabanından okunur: yetkisi alınan süper admin bir sonraki istekte giremez', async () => {
    const token = await tokenFor(SUPER.email);
    row('su-1').role = 'admin';
    expect((await request(app).get('/v1/admin/panel-users').set(as(token))).status).toBe(403);
  });
});

describe('süper admin işlemleri', () => {
  let token;
  beforeEach(async () => {
    token = await tokenFor(SUPER.email);
  });
  const call = (method, path, body) => request(app)[method](`/v1/admin/panel-users${path}`).set(as(token)).send(body);

  it('listeyi yeniden eskiye döner; status ve Türkçe büyük/küçük harf duyarsız q ile süzer', async () => {
    const all = await call('get', '');
    expect(all.status).toBe(200);
    expect(all.body.items.map((u) => u.id)).toEqual(['pe-1', 'ad-1', 'su-1']);
    expect(all.body.total).toBe(3);
    expect(all.body.items[0]).toMatchObject({
      email: PENDING.email, status: 'pending', bolge: 'Antalya OBM', isletme: 'Manavgat OİM', requestNote: 'Saha koordinasyonu',
    });
    expect(all.body.items[0]).not.toHaveProperty('password_hash');

    expect((await call('get', '?status=pending')).body.items.map((u) => u.id)).toEqual(['pe-1']);
    expect((await call('get', '?q=İSMAİL')).body.items.map((u) => u.id)).toEqual(['pe-1']);
    expect((await call('get', '?q=ISMAIL')).body.items.map((u) => u.id)).toEqual(['pe-1']);
    expect((await call('get', '?q=ayşe')).body.items.map((u) => u.id)).toEqual(['ad-1']);
    expect((await call('get', '?status=yok')).status).toBe(400);
  });

  it('detay ve 404', async () => {
    expect((await call('get', '/ad-1')).body).toMatchObject({ id: 'ad-1', role: 'admin', status: 'active' });
    const missing = await call('get', '/yok');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('panel_user_not_found');
  });

  it('bekleyen talebi onaylar: aktif olur, onaylayan kaydedilir, kişi kendi şifresiyle girer', async () => {
    const res = await call('post', '/pe-1/approve');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'active', approvedBy: 'su-1' });
    expect(row('pe-1').approved_at).toBeInstanceOf(Date);
    expect(actions()).toContain('user.approve');
    expect(await tokenFor(PENDING.email)).toEqual(expect.any(String));
  });

  it('bekleyen olmayan hesap onaylanamaz / reddedilemez: 409 invalid_state', async () => {
    expect((await call('post', '/ad-1/approve')).body.error.code).toBe('invalid_state');
    expect((await call('post', '/ad-1/reject', {})).body.error.code).toBe('invalid_state');
    expect((await call('post', '/yok/approve')).status).toBe(404);
  });

  it('talebi gerekçeyle reddeder; kişi girişte gerekçeyi görür', async () => {
    const res = await call('post', '/pe-1/reject', { reason: 'Birim doğrulanamadı' });
    expect(res.body).toMatchObject({ status: 'rejected', rejectionReason: 'Birim doğrulanamadı' });

    const login = await request(app).post('/v1/admin/auth/login').send({ email: PENDING.email, password: PASSWORD });
    expect(login.body.error).toMatchObject({ code: 'account_rejected', details: { reason: 'Birim doğrulanamadı' } });
    expect(db.rows('panel_user_audit').find((a) => a.action === 'user.reject').detail).toBe(JSON.stringify({ reason: 'Birim doğrulanamadı' }));
  });

  describe('rol', () => {
    it('admini süper admin yapar ve geri alır', async () => {
      expect((await call('put', '/ad-1/role', { role: 'super_admin' })).body.role).toBe('super_admin');
      expect((await call('put', '/ad-1/role', { role: 'admin' })).body.role).toBe('admin');
      const roleAudits = db.rows('panel_user_audit').filter((a) => a.action === 'user.role');
      expect(roleAudits.map((a) => JSON.parse(a.detail))).toEqual([
        { from: 'admin', to: 'super_admin' }, { from: 'super_admin', to: 'admin' },
      ]);
    });

    it('kendi rolünü değiştiremez: 403 cannot_change_own_role', async () => {
      const res = await call('put', '/su-1/role', { role: 'admin' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('cannot_change_own_role');
    });

    it('iki süper admin aynı anda birbirinin yetkisini alırsa ikincisi 409 last_super_admin', async () => {
      // B, A'nın yetkisini az önce aldı; A'nın isteği yetki kontrolünü o değişiklikten önce geçmişti.
      seed([{ ...SUPER, role: 'admin' }, { ...ADMIN, role: 'super_admin' }]);
      const err = await service.setRole({ id: 'su-1', role: 'super_admin' }, 'ad-1', 'admin').catch((e) => e);
      expect(err).toMatchObject({ status: 409, code: 'last_super_admin' });
      expect(row('ad-1').role).toBe('super_admin');
    });

    it('rol değişmiyorsa denetime yazmaz', async () => {
      await call('put', '/ad-1/role', { role: 'admin' });
      expect(actions()).not.toContain('user.role');
    });
  });

  describe('durum', () => {
    it('admini pasifleştirir: oturumları kapanır, giremez; yeniden etkinleştirilince girer', async () => {
      const adminToken = await tokenFor(ADMIN.email);
      const res = await call('put', '/ad-1/status', { status: 'disabled' });
      expect(res.body.status).toBe('disabled');
      expect(db.rows('panel_refresh_tokens').filter((t) => t.user_id === 'ad-1').every((t) => t.revoked_at instanceof Date)).toBe(true);
      expect((await request(app).get('/v1/admin/regions').set(as(adminToken))).status).toBe(401);
      expect((await request(app).post('/v1/admin/auth/login').send({ email: ADMIN.email, password: PASSWORD })).body.error.code).toBe('account_disabled');

      expect((await call('put', '/ad-1/status', { status: 'active' })).body.status).toBe('active');
      expect(await tokenFor(ADMIN.email)).toEqual(expect.any(String));
      expect(actions()).toEqual(expect.arrayContaining(['user.disable', 'user.enable']));
    });

    it('kendi hesabını pasifleştiremez: 403 cannot_change_own_status', async () => {
      expect((await call('put', '/su-1/status', { status: 'disabled' })).body.error.code).toBe('cannot_change_own_status');
    });

    it('başka bir süper admini pasifleştirir; tek aktif süper admin kalacaksa 409 last_super_admin', async () => {
      seed([SUPER, { ...ADMIN, role: 'super_admin' }]);
      token = await tokenFor(SUPER.email);
      expect((await call('put', '/ad-1/status', { status: 'disabled' })).status).toBe(200);

      seed([{ ...SUPER, status: 'disabled' }, { ...ADMIN, role: 'super_admin' }]);
      const err = await service.setStatus({ id: 'su-1', role: 'super_admin' }, 'ad-1', 'disabled').catch((e) => e);
      expect(err).toMatchObject({ status: 409, code: 'last_super_admin' });
      expect(row('ad-1').status).toBe('active');
    });

    it('servis süper admin olmayan aktörü reddeder', async () => {
      const err = await service.approve({ id: 'ad-1', role: 'admin' }, 'pe-1').catch((e) => e);
      expect(err).toMatchObject({ status: 403, code: 'super_admin_required' });
      expect(row('pe-1').status).toBe('pending');
    });

    it('bekleyen talep etkinleştirilemez (onay ucu kullanılır): 409 invalid_state', async () => {
      expect((await call('put', '/pe-1/status', { status: 'active' })).body.error.code).toBe('invalid_state');
    });
  });

  describe('şifre sıfırlama', () => {
    it('geçici şifre döner, ilk girişte değiştirme zorunlu, eski oturumlar kapanır', async () => {
      await tokenFor(ADMIN.email);
      const res = await call('post', '/ad-1/reset-password');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.temporaryPassword).toMatch(/^[A-Za-z0-9]{20}$/);
      expect(row('ad-1')).toMatchObject({ must_change_password: true, password_hash: `hash:${res.body.temporaryPassword}` });
      expect(db.rows('panel_refresh_tokens').filter((t) => t.user_id === 'ad-1').every((t) => t.revoked_at instanceof Date)).toBe(true);

      const login = await request(app).post('/v1/admin/auth/login').send({ email: ADMIN.email, password: res.body.temporaryPassword });
      expect(login.body.user.mustChangePassword).toBe(true);
      expect(actions()).toContain('user.reset_password');
    });

    it('kendi şifresini sıfırlayamaz; onaylanmamış hesapta 409', async () => {
      expect((await call('post', '/su-1/reset-password')).body.error.code).toBe('cannot_reset_own_password');
      expect((await call('post', '/pe-1/reset-password')).body.error.code).toBe('invalid_state');
    });
  });

  it('hesap geçmişi yeniden eskiye, işlemi yapanın adıyla', async () => {
    await call('post', '/pe-1/approve');
    await call('put', '/pe-1/role', { role: 'super_admin' });
    // MySQL timestamp saniye hassasiyetinde; aynı saniyedeki kayıtlar id ile sıralanır.
    db.rows('panel_user_audit').forEach((a, i) => { a.at = new Date(Date.UTC(2026, 9, 20, 10, 0)); a.id = i + 1; });

    const res = await call('get', '/pe-1/audit');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i) => i.action)).toEqual(['user.role', 'user.approve']);
    expect(res.body.items[0]).toMatchObject({ actor: { id: 'su-1', name: 'Sistem Yöneticisi' }, detail: { from: 'admin', to: 'super_admin' } });
    expect((await call('get', '/yok/audit')).status).toBe(404);
  });
});
