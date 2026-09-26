'use strict';

// A yüz yüze theory training carries an optional session (startsAt, location,
// instructor). The panel sends them on POST/PUT /admin/trainings/online; the route
// schema must let them through to the service and reject malformed values.

jest.mock('../../../src/middlewares/auth', () => ({
  requireAdmin: (_req, _res, next) => next(),
  requireAuth: (_req, _res, next) => next(),
}));
jest.mock('../../../src/modules/trainings/trainings.service', () => ({
  adminCreateOnline: jest.fn(async (body) => ({ id: 'o1', ...body })),
  adminUpdateOnline: jest.fn(async (id, body) => ({ id, ...body })),
}));

const express = require('express');
const request = require('supertest');
const trainingsService = require('../../../src/modules/trainings/trainings.service');
const adminRouter = require('../../../src/modules/admin/admin.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');

const validBody = {
  title: 'Yangın Güvenliği',
  durationMin: 45,
  delivery: 'yuzyuze',
};

const session = {
  startsAt: '2026-10-01T09:00:00.000Z',
  location: 'Bölge Müdürlüğü Konferans Salonu',
  instructor: 'Ayşe Yılmaz',
};

describe('admin online training session fields', () => {
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
  app.use(errorHandler);

  beforeEach(() => jest.clearAllMocks());

  it('passes the session fields through to adminCreateOnline on POST', async () => {
    const res = await request(app).post('/admin/trainings/online').send({ ...validBody, ...session });

    expect(res.status).toBe(200);
    const [body] = trainingsService.adminCreateOnline.mock.calls[0];
    expect(new Date(body.startsAt).toISOString()).toBe(session.startsAt);
    expect(body.location).toBe(session.location);
    expect(body.instructor).toBe(session.instructor);
  });

  it('passes the session fields through to adminUpdateOnline on PUT', async () => {
    const res = await request(app).put('/admin/trainings/online/o1').send(session);

    expect(res.status).toBe(200);
    const [id, body] = trainingsService.adminUpdateOnline.mock.calls[0];
    expect(id).toBe('o1');
    expect(new Date(body.startsAt).toISOString()).toBe(session.startsAt);
    expect(body.location).toBe(session.location);
    expect(body.instructor).toBe(session.instructor);
  });

  it('accepts null session fields on PUT so the panel can clear them', async () => {
    const res = await request(app)
      .put('/admin/trainings/online/o1')
      .send({ startsAt: null, location: null, instructor: '' });

    expect(res.status).toBe(200);
    expect(trainingsService.adminUpdateOnline).toHaveBeenCalledWith(
      'o1',
      { startsAt: null, location: null, instructor: '' },
      expect.anything(),
    );
  });

  it('rejects a non-ISO startsAt on POST', async () => {
    const res = await request(app)
      .post('/admin/trainings/online')
      .send({ ...validBody, startsAt: 'next tuesday' });

    expect(res.status).toBe(400);
    expect(trainingsService.adminCreateOnline).not.toHaveBeenCalled();
  });

  it('rejects a non-ISO startsAt on PUT', async () => {
    const res = await request(app).put('/admin/trainings/online/o1').send({ startsAt: '01/10/2026' });

    expect(res.status).toBe(400);
    expect(trainingsService.adminUpdateOnline).not.toHaveBeenCalled();
  });

  it('rejects a location longer than 200 characters on POST', async () => {
    const res = await request(app)
      .post('/admin/trainings/online')
      .send({ ...validBody, location: 'x'.repeat(201) });

    expect(res.status).toBe(400);
    expect(trainingsService.adminCreateOnline).not.toHaveBeenCalled();
  });

  it('rejects a location longer than 200 characters on PUT', async () => {
    const res = await request(app).put('/admin/trainings/online/o1').send({ location: 'x'.repeat(201) });

    expect(res.status).toBe(400);
    expect(trainingsService.adminUpdateOnline).not.toHaveBeenCalled();
  });

  it('rejects an instructor longer than 120 characters on POST', async () => {
    const res = await request(app)
      .post('/admin/trainings/online')
      .send({ ...validBody, instructor: 'x'.repeat(121) });

    expect(res.status).toBe(400);
    expect(trainingsService.adminCreateOnline).not.toHaveBeenCalled();
  });

  it('rejects an instructor longer than 120 characters on PUT', async () => {
    const res = await request(app).put('/admin/trainings/online/o1').send({ instructor: 'x'.repeat(121) });

    expect(res.status).toBe(400);
    expect(trainingsService.adminUpdateOnline).not.toHaveBeenCalled();
  });

  it('accepts an instructor of exactly 120 characters', async () => {
    const res = await request(app).put('/admin/trainings/online/o1').send({ instructor: 'x'.repeat(120) });

    expect(res.status).toBe(200);
  });
});
