'use strict';

// /v1/admin/auth route entegrasyonu: gerçek router + validate + requireAdminAuth
// zinciri, adminAuth.service mock'lanır (DB/Redis'e dokunulmaz). Gerçek express app'in
// tamamı yerine bu router'ı aynı mount path'iyle (/v1/admin/auth) bağlayan minimal
// bir app kurulur; böylece login'in requireAdmin'DEN ÖNCE, kimliksiz erişilebilir
// olduğu (app.js mount sırası) ve status kod sözleşmesi doğrulanır.

// logger (winston-daily-rotate) import anında /app/logs'a yazmaya çalışır; yazılabilir
// bir dizine yönlendir.
const os = require('os');
const path = require('path');
process.env.LOG_DIR = path.join(os.tmpdir(), 'ogm-jest-logs');
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'ogm-jest-uploads');

const mockLogin = jest.fn();
const mockRefresh = jest.fn();
const mockLogout = jest.fn();
const mockMe = jest.fn();

jest.mock('../../../src/modules/admin/auth/adminAuth.service', () => ({
  login: (...a) => mockLogin(...a),
  refresh: (...a) => mockRefresh(...a),
  logout: (...a) => mockLogout(...a),
  me: (...a) => mockMe(...a),
}));

const express = require('express');
const request = require('supertest');
const adminAuthRoutes = require('../../../src/modules/admin/auth/adminAuth.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');
const { signAccessToken } = require('../../../src/shared/jwt');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/v1/admin/auth', adminAuthRoutes);
  app.use(errorHandler);
  return app;
}

const app = buildApp();

beforeEach(() => jest.clearAllMocks());

describe('POST /v1/admin/auth/login', () => {
  test('kimlik doğrulama olmadan erişilebilir + geçerli body 200 döner', async () => {
    mockLogin.mockResolvedValueOnce({
      accessToken: 'a.jwt',
      refreshToken: 'r.jwt',
      expiresIn: 900,
      admin: { id: 'adm-1', eposta: 'admin@ogm.gov.tr', role: 'admin' },
    });

    const res = await request(app)
      .post('/v1/admin/auth/login')
      .send({ eposta: 'admin@ogm.gov.tr', sifre: 'password1' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ accessToken: 'a.jwt', refreshToken: 'r.jwt' });
    expect(mockLogin).toHaveBeenCalledTimes(1);
  });

  test('geçersiz e-posta 400 (validation) döner, servis çağrılmaz', async () => {
    const res = await request(app)
      .post('/v1/admin/auth/login')
      .send({ eposta: 'not-an-email', sifre: 'password1' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(mockLogin).not.toHaveBeenCalled();
  });

  test('kısa şifre (min 8) 400 döner', async () => {
    const res = await request(app)
      .post('/v1/admin/auth/login')
      .send({ eposta: 'admin@ogm.gov.tr', sifre: 'short' });

    expect(res.status).toBe(400);
    expect(mockLogin).not.toHaveBeenCalled();
  });

  test('eksik alanlar 400 döner', async () => {
    const res = await request(app).post('/v1/admin/auth/login').send({});
    expect(res.status).toBe(400);
    expect(mockLogin).not.toHaveBeenCalled();
  });
});

describe('POST /v1/admin/auth/refresh', () => {
  test('geçerli refreshToken 200 döner', async () => {
    mockRefresh.mockResolvedValueOnce({ accessToken: 'a2', refreshToken: 'r2', expiresIn: 900 });
    const res = await request(app)
      .post('/v1/admin/auth/refresh')
      .send({ refreshToken: 'r.jwt' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ accessToken: 'a2' });
  });

  test('refreshToken eksikse 400 döner', async () => {
    const res = await request(app).post('/v1/admin/auth/refresh').send({});
    expect(res.status).toBe(400);
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

describe('POST /v1/admin/auth/logout', () => {
  test('geçerli refreshToken 204 döner (gövdesiz)', async () => {
    mockLogout.mockResolvedValueOnce(undefined);
    const res = await request(app)
      .post('/v1/admin/auth/logout')
      .send({ refreshToken: 'r.jwt' });

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  test('refreshToken eksikse 400 döner', async () => {
    const res = await request(app).post('/v1/admin/auth/logout').send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /v1/admin/auth/me (requireAdminAuth)', () => {
  test('token yoksa 401 döner', async () => {
    const res = await request(app).get('/v1/admin/auth/me');
    expect(res.status).toBe(401);
    expect(mockMe).not.toHaveBeenCalled();
  });

  test("gönüllü token (atyp yok) 403 döner", async () => {
    const volunteerToken = signAccessToken({ sub: 'user-1' });
    const res = await request(app)
      .get('/v1/admin/auth/me')
      .set('Authorization', `Bearer ${volunteerToken}`);

    expect(res.status).toBe(403);
    expect(mockMe).not.toHaveBeenCalled();
  });

  test('geçerli admin token: 200 + servis req.user.id ile çağrılır', async () => {
    mockMe.mockResolvedValueOnce({
      id: 'adm-1', eposta: 'admin@ogm.gov.tr', ad: 'Sistem', soyad: 'Yöneticisi', role: 'admin',
    });
    const adminToken = signAccessToken({ sub: 'adm-1', atyp: 'admin', role: 'admin' });

    const res = await request(app)
      .get('/v1/admin/auth/me')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.admin).toMatchObject({ id: 'adm-1', role: 'admin' });
    expect(mockMe).toHaveBeenCalledWith('adm-1');
  });
});
