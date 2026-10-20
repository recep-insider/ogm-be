'use strict';

// PATCH /admin/missions/:id yalnızca düzenlenebilir alanları servise geçirir;
// toplanma noktası görevli alanları PUT /assembly-point şemasından geçer.

jest.mock('../../../src/middlewares/auth', () => ({
  requireAdmin: (_req, _res, next) => next(),
  requireAuth: (_req, _res, next) => next(),
}));
jest.mock('../../../src/modules/missions/missions.service', () => ({
  adminUpdate: jest.fn(async (missionId) => ({ ok: true, missionId })),
}));
jest.mock('../../../src/modules/missions/assemblyPoints.service', () => ({
  upsert: jest.fn(async () => ({ ok: true })),
}));

const express = require('express');
const request = require('supertest');
const missionsService = require('../../../src/modules/missions/missions.service');
const assemblyPointsService = require('../../../src/modules/missions/assemblyPoints.service');
const adminRouter = require('../../../src/modules/admin/admin.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');

describe('PATCH /admin/missions/:id', () => {
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
  app.use(errorHandler);

  beforeEach(() => jest.clearAllMocks());

  it('düzenlenemeyen alanları servise geçirmez', async () => {
    const res = await request(app)
      .patch('/admin/missions/m1')
      .send({
        title: 'Yeni',
        description: null,
        status: 'archived',
        iconName: 'fire',
        startDate: '2026-10-01',
        assemblyPoint: { name: 'X' },
        callVolunteers: true,
        linkedReportIds: ['r1'],
      });

    expect(res.status).toBe(200);
    expect(missionsService.adminUpdate).toHaveBeenCalledWith(
      'm1',
      { title: 'Yeni', description: null },
      expect.anything(),
    );
  });

  it('boş gövdeyi reddeder', async () => {
    const res = await request(app).patch('/admin/missions/m1').send({});

    expect(res.status).toBe(400);
    expect(missionsService.adminUpdate).not.toHaveBeenCalled();
  });

  it('eksik koordinatı reddeder', async () => {
    const res = await request(app).patch('/admin/missions/m1').send({ coordinates: { lat: 36.8 } });

    expect(res.status).toBe(400);
  });
});

describe('PUT /admin/missions/:id/assembly-point — görevli alanları', () => {
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
  app.use(errorHandler);

  const point = { name: 'Okul bahçesi', coordinates: { lat: 36.86, lng: 28.28 } };

  beforeEach(() => jest.clearAllMocks());

  it('görevli adı ve telefonunu geçirir', async () => {
    const res = await request(app)
      .put('/admin/missions/m1/assembly-point')
      .send({ ...point, officerName: 'Mehmet Kaya', officerPhone: '+90 (532) 111-22-33' });

    expect(res.status).toBe(200);
    expect(assemblyPointsService.upsert.mock.calls[0][1]).toMatchObject({
      officerName: 'Mehmet Kaya',
      officerPhone: '+90 (532) 111-22-33',
    });
  });

  it('harf içeren telefonu reddeder', async () => {
    const res = await request(app)
      .put('/admin/missions/m1/assembly-point')
      .send({ ...point, officerPhone: '0532abc' });

    expect(res.status).toBe(400);
    expect(assemblyPointsService.upsert).not.toHaveBeenCalled();
  });
});
