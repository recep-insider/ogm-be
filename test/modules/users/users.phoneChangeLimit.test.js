'use strict';

// /users/me/phone-change uçları /auth/phone OTP uçları gibi hız sınırlıdır (kullanıcı başına).

jest.mock('../../../src/middlewares/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: req.get('x-test-user') || 'u1' };
    next();
  },
}));
jest.mock('../../../src/modules/users/users.controller', () => new Proxy({}, {
  get: () => (_req, res) => res.status(200).json({ ok: true }),
}));

const express = require('express');
const request = require('supertest');
const usersRouter = require('../../../src/modules/users/users.routes');

const app = express();
app.use(express.json());
app.use('/users', usersRouter);

const init = (user = 'u1') =>
  request(app).post('/users/me/phone-change/init').set('x-test-user', user).send({ phone: '+905321112233' });

describe('POST /users/me/phone-change/* hız sınırı', () => {
  it('init kullanıcı başına saatte 5 istekten sonra 429 rate_limited döner', async () => {
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      expect((await init()).status).toBe(200);
    }
    const blocked = await init();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('rate_limited');

    expect((await init('u2')).status).toBe(200);
  });

  it('commit kullanıcı başına sınırlıdır', async () => {
    const commit = () => request(app)
      .post('/users/me/phone-change/commit')
      .set('x-test-user', 'u3')
      .send({ sessionId: '6f1c1d2e-8a4b-4c3d-9e5f-0a1b2c3d4e5f', code: '123456' });

    const first = await commit();
    expect(first.status).toBe(200);
    expect(first.headers.ratelimit).toMatch(/limit=60/);
  });
});
