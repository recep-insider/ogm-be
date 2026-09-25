'use strict';

// K4 made saha capacity a hard limit: applySaha answers 410 training_full once
// applications reach total_seats. A training created with 0 seats could never be
// joined, so the panel must send a positive totalSeats when creating one.

jest.mock('../../../src/middlewares/auth', () => ({
  requireAdmin: (_req, _res, next) => next(),
  requireAuth: (_req, _res, next) => next(),
}));
jest.mock('../../../src/modules/trainings/trainings.service', () => ({
  adminCreateSaha: jest.fn(async (body) => ({ id: 't1', ...body })),
  adminUpdateSaha: jest.fn(async (id, body) => ({ id, ...body })),
}));

const express = require('express');
const request = require('supertest');
const trainingsService = require('../../../src/modules/trainings/trainings.service');
const adminRouter = require('../../../src/modules/admin/admin.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');

const validBody = {
  title: 'Saha Eğitimi',
  location: 'Antalya',
  startDate: '2026-10-01',
  startTime: '09:00',
  endTime: '17:00',
  instructorName: 'Eğitmen',
  totalSeats: 20,
};

describe('admin saha training seat validation', () => {
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
  app.use(errorHandler);

  beforeEach(() => jest.clearAllMocks());

  it('creates a saha training with a positive seat count', async () => {
    const res = await request(app).post('/admin/trainings/saha').send(validBody);

    expect(res.status).toBe(200);
    expect(trainingsService.adminCreateSaha).toHaveBeenCalledWith(
      expect.objectContaining({ totalSeats: 20 }),
      expect.anything(),
    );
  });

  it('rejects a create without totalSeats', async () => {
    const { totalSeats: _omit, ...body } = validBody;
    const res = await request(app).post('/admin/trainings/saha').send(body);

    expect(res.status).toBe(400);
    expect(trainingsService.adminCreateSaha).not.toHaveBeenCalled();
  });

  it('rejects zero seats on create and on update', async () => {
    const created = await request(app).post('/admin/trainings/saha').send({ ...validBody, totalSeats: 0 });
    const updated = await request(app).put('/admin/trainings/saha/t1').send({ totalSeats: 0 });

    expect(created.status).toBe(400);
    expect(updated.status).toBe(400);
    expect(trainingsService.adminCreateSaha).not.toHaveBeenCalled();
    expect(trainingsService.adminUpdateSaha).not.toHaveBeenCalled();
  });
});
