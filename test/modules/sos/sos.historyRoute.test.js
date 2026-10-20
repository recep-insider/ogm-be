'use strict';

// POST /admin/sos-reports/:id/history — kaldırılan arama aksiyonları şemada reddedilir.

jest.mock('../../../src/middlewares/auth', () => ({
  requireAdmin: (_req, _res, next) => next(),
  requireAuth: (_req, _res, next) => next(),
}));
jest.mock('../../../src/modules/sos/sos.service', () => ({
  adminAddHistory: jest.fn(async (sosId) => ({ ok: true, sosId })),
}));

const express = require('express');
const request = require('supertest');
const sosService = require('../../../src/modules/sos/sos.service');
const adminRouter = require('../../../src/modules/admin/admin.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');

describe('POST /admin/sos-reports/:id/history', () => {
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
  app.use(errorHandler);

  beforeEach(() => jest.clearAllMocks());

  it.each([['called_volunteer'], ['called_112']])('%s aksiyonunu reddeder', async (action) => {
    const res = await request(app).post('/admin/sos-reports/s1/history').send({ action });

    expect(res.status).toBe(400);
    expect(sosService.adminAddHistory).not.toHaveBeenCalled();
  });

  it.each([[{ action: 'responded' }], [{ note: '112 arandı' }]])('%p kabul edilir', async (body) => {
    const res = await request(app).post('/admin/sos-reports/s1/history').send(body);

    expect(res.status).toBe(200);
    expect(sosService.adminAddHistory).toHaveBeenCalledWith('s1', body, expect.anything());
  });
});
