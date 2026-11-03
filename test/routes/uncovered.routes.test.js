'use strict';

// A78 (qa/backend-mimari.md §8): route testi olmayan uçlar — gerçek app.js üzerinden kimlik, doğrulama ve
// servise geçen argümanlar. İş kuralları kendi servis testlerinde.

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ogm-routes-'));

jest.mock('bcrypt', () => require('../modules/admin/panel-fakes').fakeBcrypt);
jest.mock('../../src/config/db', () => ({ db: require('../modules/admin/panel-fakes').createFakeDb() }));
jest.mock('../../src/config/redis', () => ({ redis: require('../modules/admin/panel-fakes').createFakeRedis() }));
jest.mock('../../src/middlewares/rate-limit', () => ({
  ...jest.requireActual('../../src/middlewares/rate-limit'),
  generalLimiter: (_req, _res, next) => next(),
}));
jest.mock('../../src/middlewares/auth', () => {
  const actual = jest.requireActual('../../src/middlewares/auth');
  const volunteer = (req, res, next) => {
    if (!req.headers.authorization) return res.status(401).json({ error: { code: 'unauthorized' } });
    req.user = { id: 'u1' };
    return next();
  };
  return {
    ...actual,
    requireAuth: volunteer,
    optionalAuth: (req, _res, next) => {
      req.user = req.headers.authorization ? { id: 'u1' } : null;
      next();
    },
    requireAdmin: (req, _res, next) => {
      req.user = { id: 'p1' };
      req.panelUser = { id: 'p1', name: 'Operatör Ayşe' };
      next();
    },
  };
});
const mockOk = (value) => jest.fn(async () => value);
jest.mock('../../src/modules/users/users.service', () => ({
  ...jest.requireActual('../../src/modules/users/users.service'),
  getMe: mockOk({ id: 'u1' }),
  softDelete: mockOk({ ok: true }),
  setAvatar: mockOk({ ok: true }),
  recordConsent: mockOk({ ok: true }),
}));
jest.mock('../../src/modules/home/home.service', () => ({ getFeed: mockOk({ news: [] }) }));
jest.mock('../../src/modules/reference/reference.service', () => ({ getCategory: mockOk([]) }));
jest.mock('../../src/modules/emergency/emergency.service', () => ({
  ...jest.requireActual('../../src/modules/emergency/emergency.service'),
  create: mockOk({ ok: true }),
  adminList: mockOk({ items: [] }),
}));
jest.mock('../../src/modules/notifications/notifications.service', () => ({
  ...jest.requireActual('../../src/modules/notifications/notifications.service'),
  deleteDevice: mockOk(undefined),
}));
jest.mock('../../src/modules/sos/sos.service', () => ({
  ...jest.requireActual('../../src/modules/sos/sos.service'),
  getActiveForUser: mockOk(null),
  getForUser: mockOk({ sosId: 's1' }),
}));
jest.mock('../../src/modules/notifications/dispatch.service', () => ({
  ...jest.requireActual('../../src/modules/notifications/dispatch.service'),
  history: mockOk({ items: [] }),
}));
jest.mock('../../src/modules/admin/admin.service', () => ({
  ...jest.requireActual('../../src/modules/admin/admin.service'),
  dashboardSummary: mockOk({ volunteers: 0 }),
  setCommissionDecision: mockOk({ decision: 'approved' }),
}));

const request = require('supertest');
const app = require('../../src/app');
const usersService = require('../../src/modules/users/users.service');
const homeService = require('../../src/modules/home/home.service');
const referenceService = require('../../src/modules/reference/reference.service');
const emergencyService = require('../../src/modules/emergency/emergency.service');
const notificationsService = require('../../src/modules/notifications/notifications.service');
const sosService = require('../../src/modules/sos/sos.service');
const dispatchService = require('../../src/modules/notifications/dispatch.service');
const adminService = require('../../src/modules/admin/admin.service');

const AUTH = { Authorization: 'Bearer t' };
const server = app.listen(0);
const api = () => request(server);

afterAll(() => new Promise((done) => server.close(done)));
beforeEach(() => jest.clearAllMocks());

describe('gönüllü uçları — kimliksiz 401, kimlikle oturumdaki kullanıcıya gider', () => {
  it.each([
    ['get', '/v1/users/me', () => usersService.getMe, ['u1']],
    ['delete', '/v1/users/me', () => usersService.softDelete, ['u1', expect.anything()]],
    ['delete', '/v1/notifications/devices/d1', () => notificationsService.deleteDevice, ['u1', 'd1']],
    ['get', '/v1/sos/active', () => sosService.getActiveForUser, ['u1']],
    ['get', '/v1/sos/s1', () => sosService.getForUser, ['s1', 'u1']],
  ])('%s %s', async (method, url, fn, args) => {
    expect((await api()[method](url)).status).toBe(401);
    expect(fn()).not.toHaveBeenCalled();

    const res = await api()[method](url).set(AUTH);
    expect(res.status).toBeLessThan(300);
    expect(fn()).toHaveBeenCalledWith(...args);
  });
});

describe('POST /v1/emergency — doğrulama', () => {
  it('geçersiz koordinat 400, kayıt yok', async () => {
    const res = await api().post('/v1/emergency').set(AUTH).send({ coordinates: { lat: 999, lng: 28 } });
    expect(res.status).toBe(400);
    expect(emergencyService.create).not.toHaveBeenCalled();
  });

  it('geçerli gövde oturumdaki kullanıcıyla kaydedilir', async () => {
    const res = await api().post('/v1/emergency').set(AUTH).send({ coordinates: { lat: 36.8, lng: 28.2 }, message: ' Yardım ' });
    expect(res.status).toBe(200);
    expect(emergencyService.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1', body: { coordinates: { lat: 36.8, lng: 28.2 }, message: 'Yardım' },
    }));
  });
});

describe('profil yükleme ve onay', () => {
  it('avatar: PNG kabul, metin dosyası 415', async () => {
    const ok = await api().post('/v1/users/me/avatar').set(AUTH).attach('avatar', Buffer.from('png'), { filename: 'a.png', contentType: 'image/png' });
    expect(ok.status).toBe(200);
    expect(usersService.setAvatar).toHaveBeenCalledWith('u1', expect.objectContaining({ mimetype: 'image/png' }), expect.anything());

    const bad = await api().post('/v1/users/me/avatar').set(AUTH).attach('avatar', Buffer.from('x'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(bad.status).toBe(415);
  });

  it('onay: bilinmeyen belge 400, geçerli belge servise gider', async () => {
    expect((await api().post('/v1/users/me/consents').set(AUTH).send({ document: 'baska', version: 'v1.0' })).status).toBe(400);
    const res = await api().post('/v1/users/me/consents').set(AUTH).send({ document: 'kvkk', version: 'v1.0' });
    expect(res.status).toBe(201);
    expect(usersService.recordConsent).toHaveBeenCalledWith('u1', expect.objectContaining({ document: 'kvkk', version: 'v1.0' }));
  });
});

describe('herkese açık uçlar', () => {
  it('GET /v1/home/feed misafire de açık; oturum varsa kullanıcı id geçer', async () => {
    expect((await api().get('/v1/home/feed')).status).toBe(200);
    expect(homeService.getFeed).toHaveBeenLastCalledWith(null);
    await api().get('/v1/home/feed').set(AUTH);
    expect(homeService.getFeed).toHaveBeenLastCalledWith('u1');
  });

  it('GET /v1/reference/:category kategoriyi servise geçirir', async () => {
    expect((await api().get('/v1/reference/hobiler')).status).toBe(200);
    expect(referenceService.getCategory).toHaveBeenCalledWith('hobiler');
  });
});

describe('panel uçları', () => {
  it('acil listesi ve bildirim geçmişi sorgu doğrulamasından geçer', async () => {
    expect((await api().get('/v1/admin/emergency-reports?page=0')).status).toBe(400);
    expect((await api().get('/v1/admin/emergency-reports?page=2')).status).toBe(200);
    expect(emergencyService.adminList).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));

    expect((await api().get('/v1/admin/notifications')).status).toBe(200);
    expect(dispatchService.history).toHaveBeenCalled();
  });

  it('pano özeti', async () => {
    const res = await api().get('/v1/admin/dashboard/summary');
    expect(res.body).toEqual({ volunteers: 0 });
  });

  it('komisyon kararı: geçersiz karar 400; geçerli karar oturumdaki operatörle', async () => {
    expect((await api().post('/v1/admin/volunteers/u9/commission').send({ decision: 'belki' })).status).toBe(400);
    const res = await api().post('/v1/admin/volunteers/u9/commission').send({ decision: 'approved' });
    expect(res.status).toBe(200);
    expect(adminService.setCommissionDecision).toHaveBeenCalledWith('u9', expect.objectContaining({ decision: 'approved' }), expect.objectContaining({ userId: 'p1', name: 'Operatör Ayşe' }));
  });
});
