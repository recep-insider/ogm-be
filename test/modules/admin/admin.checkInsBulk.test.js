'use strict';

// GET /admin/check-ins?missionIds=a,b — virgülle ayrılmış 1–100 tekil olay id'si;
// tekrarlar ve boşluklar sınırda atılır, servis temiz diziyi alır.

jest.mock('../../../src/middlewares/auth', () => ({
  requireAdmin: (_req, _res, next) => next(),
  requireAuth: (_req, _res, next) => next(),
}));
jest.mock('../../../src/modules/missions/missions.service', () => ({
  adminCheckInsBulk: jest.fn(async () => ({ items: [] })),
}));

const express = require('express');
const request = require('supertest');
const missionsService = require('../../../src/modules/missions/missions.service');
const adminRouter = require('../../../src/modules/admin/admin.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');

describe('GET /admin/check-ins', () => {
  const app = express();
  app.use('/admin', adminRouter);
  app.use(errorHandler);

  const ids = (n, prefix = 'm') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

  beforeEach(() => jest.clearAllMocks());

  it('id listesini kırpar, boşları ve tekrarları atar, sırayı korur', async () => {
    const res = await request(app).get('/admin/check-ins').query({ missionIds: 'm2, m1,,m2 ,m3' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
    expect(missionsService.adminCheckInsBulk).toHaveBeenCalledWith(['m2', 'm1', 'm3']);
  });

  it('tekrarlar atıldıktan sonra 100 id kabul edilir', async () => {
    const list = ids(100);
    const res = await request(app).get('/admin/check-ins').query({ missionIds: [...list, ...list.slice(0, 20)].join(',') });

    expect(res.status).toBe(200);
    expect(missionsService.adminCheckInsBulk).toHaveBeenCalledWith(list);
  });

  it('36 karakterlik uuid kabul edilir', async () => {
    const uuid = '0b7c2a5e-3f1d-4c8e-9a2b-1d2e3f4a5b6c';
    const res = await request(app).get('/admin/check-ins').query({ missionIds: uuid });

    expect(res.status).toBe(200);
    expect(missionsService.adminCheckInsBulk).toHaveBeenCalledWith([uuid]);
  });

  it.each([
    ['eksik', {}],
    ['boş', { missionIds: '' }],
    ['yalnız virgül', { missionIds: ' , ,' }],
    ['101 tekil id', { missionIds: ids(101).join(',') }],
    ['36 karakterden uzun id', { missionIds: `m1,${'x'.repeat(37)}` }],
  ])('%s → 400 validation_error, servis çağrılmaz', async (_label, query) => {
    const res = await request(app).get('/admin/check-ins').query(query);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(missionsService.adminCheckInsBulk).not.toHaveBeenCalled();
  });

  it('missionIds birden çok kez verilirse (dizi) 400', async () => {
    const res = await request(app).get('/admin/check-ins?missionIds=m1&missionIds=m2');

    expect(res.status).toBe(400);
    expect(missionsService.adminCheckInsBulk).not.toHaveBeenCalled();
  });
});
