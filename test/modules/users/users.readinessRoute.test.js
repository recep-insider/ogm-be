'use strict';

// GET /users/me/readiness used to throw a ReferenceError (readinessService was never
// required in users.routes.js), so every call answered 500.

jest.mock('../../../src/middlewares/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'u1' };
    next();
  },
}));
jest.mock('../../../src/modules/users/users.controller', () => new Proxy({}, { get: () => jest.fn() }));
jest.mock('../../../src/modules/users/readiness.service', () => ({
  getReadiness: jest.fn(async (userId) => ({
    userId,
    zincir: { steps: [], eksikAdimlar: [], siradakiAdim: null, tamam: true },
    kisiDurumu: 'hazir',
    mudahaleYetkisi: true,
    engeller: [],
  })),
}));

const express = require('express');
const request = require('supertest');
const readinessService = require('../../../src/modules/users/readiness.service');
const usersRouter = require('../../../src/modules/users/users.routes');

describe('GET /users/me/readiness', () => {
  const app = express();
  app.use('/users', usersRouter);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

  it('answers 200 with the derived readiness chain for the signed-in user', async () => {
    const res = await request(app).get('/users/me/readiness');

    expect(res.status).toBe(200);
    expect(readinessService.getReadiness).toHaveBeenCalledWith('u1');
    expect(res.body).toMatchObject({ kisiDurumu: 'hazir', engeller: [] });
  });
});
