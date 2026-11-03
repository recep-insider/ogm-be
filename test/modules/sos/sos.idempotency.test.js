'use strict';

// SOS çağrısı Idempotency-Key taşısa da Redis kesintisinde işlenir (K23).

jest.mock('../../../src/middlewares/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'u1' };
    next();
  },
}));
jest.mock('../../../src/config/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));
jest.mock('../../../src/config/redis', () => ({
  redis: {
    set: jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }),
    get: jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }),
  },
}));
jest.mock('../../../src/modules/sos/sos.service', () => ({
  create: jest.fn(async () => ({ ok: true, sosId: 's1', status: 'active' })),
}));

const express = require('express');
const request = require('supertest');
const { redis } = require('../../../src/config/redis');
const service = require('../../../src/modules/sos/sos.service');
const router = require('../../../src/modules/sos/sos.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');

const app = express();
app.use(express.json());
app.use('/sos', router);
app.use(errorHandler);

describe('POST /sos — Idempotency-Key', () => {
  it('Redis erişilemezse çağrı yine 2xx ile kaydedilir', async () => {
    const res = await request(app).post('/sos').set('Idempotency-Key', 'k-1').send({});

    expect(redis.set).toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, sosId: 's1' });
    expect(service.create).toHaveBeenCalledTimes(1);
  });
});
