'use strict';

// BUG-058: olmayan gönüllü ya da olay için türetilmiş boş görünüm yerine 404.
// BUG-061 / BUG-105: KKD tesliminde gelecek tarih ve bilinmeyen kalem anahtarlı seri no 400.

jest.mock('../../../src/middlewares/auth', () => ({
  requireAdmin: (_req, _res, next) => next(),
  requireAuth: (_req, _res, next) => next(),
}));
jest.mock('../../../src/config/db', () => ({ db: require('./panel-fakes').createFakeDb() }));
jest.mock('../../../src/config/redis', () => ({ redis: require('./panel-fakes').createFakeRedis() }));
jest.mock('../../../src/modules/users/readiness.service', () => ({
  ...jest.requireActual('../../../src/modules/users/readiness.service'),
  kkdSet: jest.fn(async () => []),
  getReadiness: jest.fn(async () => ({ kisiDurumu: 'hazir' })),
}));
jest.mock('../../../src/modules/equipment/equipment.service', () => ({
  ...jest.requireActual('../../../src/modules/equipment/equipment.service'),
  deliverKkdSet: jest.fn(async () => ({ ok: true })),
}));

const express = require('express');
const request = require('supertest');
const { db } = require('../../../src/config/db');
const equipmentService = require('../../../src/modules/equipment/equipment.service');
const adminRouter = require('../../../src/modules/admin/admin.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');

const app = express();
app.use(express.json());
app.use('/admin', adminRouter);
app.use(errorHandler);

beforeEach(() => {
  jest.clearAllMocks();
  db.reset({
    users: [{ id: 'u1', anonymized_at: null }],
    missions: [{ id: 'm1' }],
    assembly_points: [{ id: 'a1', mission_id: 'm1', name: 'Okul', lat: 36.8, lng: 28.2, is_open: true }],
  });
});

describe('olmayan kayıt 404 (BUG-058)', () => {
  it.each([
    ['/admin/volunteers/yok/kkd', 'user_not_found'],
    ['/admin/volunteers/yok/readiness', 'user_not_found'],
    ['/admin/missions/yok/assembly-point', 'mission_not_found'],
  ])('%s → 404 %s', async (url, code) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(code);
  });

  it.each(['/admin/volunteers/u1/kkd', '/admin/volunteers/u1/readiness', '/admin/missions/m1/assembly-point'])(
    'var olan kayıtta %s 200', async (url) => {
      expect((await request(app).get(url)).status).toBe(200);
    },
  );
});

describe('KKD teslim gövdesi (BUG-061, BUG-105)', () => {
  const deliver = (body) => request(app).post('/admin/volunteers/u1/kkd').send(body);

  it('gelecek teslim tarihi 400 assignedAt', async () => {
    const res = await deliver({ assignedAt: '2035-01-01' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.errors.map((e) => e.field)).toEqual(['assignedAt']);
    expect(equipmentService.deliverKkdSet).not.toHaveBeenCalled();
  });

  it('bilinmeyen kalem anahtarı 400 serials.ceket, sessizce atılmaz', async () => {
    const res = await deliver({ serials: { ceket: 'S1', kask: 'S2' } });
    expect(res.status).toBe(400);
    expect(res.body.error.details.errors.map((e) => e.field)).toEqual(['serials.ceket']);
  });

  it('geçerli seri no ve bugünkü tarih servise gider', async () => {
    const res = await deliver({ serials: { kask: 'S1' }, assignedAt: new Date().toISOString() });
    expect(res.status).toBe(200);
    expect(equipmentService.deliverKkdSet).toHaveBeenCalledWith('u1', expect.objectContaining({ serials: { kask: 'S1' } }), expect.anything());
  });
});
