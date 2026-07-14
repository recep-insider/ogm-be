'use strict';

// /v1/admin/staff route entegrasyonu: gerçek admin.routes (requireAdmin guard +
// createStaffSchema/updateStaffSchema validation) mount edilir; staff.service
// mock'lanır (DB'ye dokunulmaz). requireAdmin'i gerçek bir role='admin' access
// token ile geçeriz — böylece yetki + validation zinciri uçtan uca doğrulanır.

const os = require('os');
const path = require('path');
process.env.LOG_DIR = path.join(os.tmpdir(), 'ogm-jest-logs');
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'ogm-jest-uploads');

const mockCreateStaff = jest.fn();
const mockUpdateStaff = jest.fn();
const mockListStaff = jest.fn();

jest.mock('../../../src/modules/admin/staff.service', () => ({
  // admin.routes, şemaları kurarken import anında ROLES'u okur.
  ROLES: ['admin', 'officer'],
  listStaff: (...a) => mockListStaff(...a),
  createStaff: (...a) => mockCreateStaff(...a),
  updateStaff: (...a) => mockUpdateStaff(...a),
  publicStaff: (x) => x,
}));

const express = require('express');
const request = require('supertest');
const adminRoutes = require('../../../src/modules/admin/admin.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');
const { signAccessToken } = require('../../../src/shared/jwt');

const ADMIN_TOKEN = signAccessToken({ sub: 'adm-1', role: 'admin' });
const OFFICER_TOKEN = signAccessToken({ sub: 'off-1', role: 'officer' });

const app = express();
app.use(express.json());
app.use('/v1/admin', adminRoutes);
app.use(errorHandler);

const auth = (token) => `Bearer ${token}`;

beforeEach(() => jest.clearAllMocks());

describe('POST /v1/admin/staff (createStaffSchema)', () => {
  test('geçerli body 201 + createStaff çağrılır', async () => {
    mockCreateStaff.mockResolvedValueOnce({ id: 'new-1', eposta: 'yeni@ogm.gov.tr', role: 'officer' });

    const res = await request(app)
      .post('/v1/admin/staff')
      .set('Authorization', auth(ADMIN_TOKEN))
      .send({ eposta: 'yeni@ogm.gov.tr', sifre: 'password1', role: 'officer' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 'new-1', role: 'officer' });
    expect(mockCreateStaff).toHaveBeenCalledTimes(1);
  });

  test('geçersiz role 400 döner, servis çağrılmaz', async () => {
    const res = await request(app)
      .post('/v1/admin/staff')
      .set('Authorization', auth(ADMIN_TOKEN))
      .send({ eposta: 'yeni@ogm.gov.tr', sifre: 'password1', role: 'superuser' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(mockCreateStaff).not.toHaveBeenCalled();
  });

  test('eksik zorunlu alan (sifre) 400 döner', async () => {
    const res = await request(app)
      .post('/v1/admin/staff')
      .set('Authorization', auth(ADMIN_TOKEN))
      .send({ eposta: 'yeni@ogm.gov.tr', role: 'admin' });

    expect(res.status).toBe(400);
    expect(mockCreateStaff).not.toHaveBeenCalled();
  });

  test('officer token 403 alır (requireAdmin sadece admin)', async () => {
    const res = await request(app)
      .post('/v1/admin/staff')
      .set('Authorization', auth(OFFICER_TOKEN))
      .send({ eposta: 'yeni@ogm.gov.tr', sifre: 'password1', role: 'officer' });

    expect(res.status).toBe(403);
    expect(mockCreateStaff).not.toHaveBeenCalled();
  });

  test('kimliksiz istek 403 alır', async () => {
    const res = await request(app)
      .post('/v1/admin/staff')
      .send({ eposta: 'yeni@ogm.gov.tr', sifre: 'password1', role: 'officer' });

    expect(res.status).toBe(403);
  });
});

describe('PATCH /v1/admin/staff/:id (updateStaffSchema.min(1))', () => {
  test('boş body 400 döner (en az bir alan gerekli)', async () => {
    const res = await request(app)
      .patch('/v1/admin/staff/adm-9')
      .set('Authorization', auth(ADMIN_TOKEN))
      .send({});

    expect(res.status).toBe(400);
    expect(mockUpdateStaff).not.toHaveBeenCalled();
  });

  test('geçerli kısmi body (isActive) 200 + updateStaff çağrılır', async () => {
    mockUpdateStaff.mockResolvedValueOnce({ id: 'adm-9', isActive: false, role: 'officer' });

    const res = await request(app)
      .patch('/v1/admin/staff/adm-9')
      .set('Authorization', auth(ADMIN_TOKEN))
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(mockUpdateStaff).toHaveBeenCalledWith('adm-9', { isActive: false }, expect.any(Object));
  });

  test('geçersiz role değeri 400 döner', async () => {
    const res = await request(app)
      .patch('/v1/admin/staff/adm-9')
      .set('Authorization', auth(ADMIN_TOKEN))
      .send({ role: 'root' });

    expect(res.status).toBe(400);
    expect(mockUpdateStaff).not.toHaveBeenCalled();
  });
});
