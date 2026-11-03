'use strict';

jest.mock('../../../src/modules/auth/phone.service', () => ({
  restoreFlow: jest.fn(async () => ({ ok: true, isExisting: true, accessToken: 'a', refreshToken: 'r' })),
}));
jest.mock('../../../src/modules/auth/token.service', () => ({}));

const express = require('express');
const request = require('supertest');
const phoneService = require('../../../src/modules/auth/phone.service');
const router = require('../../../src/modules/auth/token.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');

const app = express();
app.use(express.json());
app.use('/v1/auth', router);
app.use(errorHandler);

describe('POST /v1/auth/restore', () => {
  it('restoreToken ile servisi çağırır ve oturumu döner', async () => {
    const res = await request(app).post('/v1/auth/restore').set('User-Agent', 'jest').send({ restoreToken: 't1' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, accessToken: 'a' });
    expect(phoneService.restoreFlow).toHaveBeenCalledWith(expect.objectContaining({ restoreToken: 't1', userAgent: 'jest' }));
  });

  it('restoreToken yoksa 400', async () => {
    const res = await request(app).post('/v1/auth/restore').send({});
    expect(res.status).toBe(400);
  });
});
