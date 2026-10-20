'use strict';

// GET /admin/missions/:id/participants — status yalnızca olay durumu sözleşmesindeki
// değerlerden biri olabilir.

jest.mock('../../../src/middlewares/auth', () => ({
  requireAdmin: (_req, _res, next) => next(),
  requireAuth: (_req, _res, next) => next(),
}));
jest.mock('../../../src/modules/missions/missions.service', () => ({
  adminParticipants: jest.fn(async () => ({ counts: {}, items: [] })),
}));

const express = require('express');
const request = require('supertest');
const missionsService = require('../../../src/modules/missions/missions.service');
const adminRouter = require('../../../src/modules/admin/admin.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');
const { EVENT_STATUS } = jest.requireActual('../../../src/modules/missions/missions.service');

describe('GET /admin/missions/:id/participants', () => {
  const app = express();
  app.use('/admin', adminRouter);
  app.use(errorHandler);

  beforeEach(() => jest.clearAllMocks());

  it.each(EVENT_STATUS)('status=%s kabul edilir ve servise geçer', async (status) => {
    const res = await request(app).get(`/admin/missions/m1/participants?status=${status}`);

    expect(res.status).toBe(200);
    expect(missionsService.adminParticipants).toHaveBeenCalledWith('m1', { status });
  });

  it('filtresiz çağrı boş sorgu geçirir', async () => {
    const res = await request(app).get('/admin/missions/m1/participants');

    expect(res.status).toBe(200);
    expect(missionsService.adminParticipants).toHaveBeenCalledWith('m1', {});
  });

  it('geçersiz status reddedilir', async () => {
    const res = await request(app).get('/admin/missions/m1/participants?status=accepted');

    expect(res.status).toBe(400);
    expect(missionsService.adminParticipants).not.toHaveBeenCalled();
  });
});
