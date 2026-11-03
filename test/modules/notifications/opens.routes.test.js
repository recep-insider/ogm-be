'use strict';

jest.mock('../../../src/middlewares/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'u1' };
    next();
  },
}));
jest.mock('../../../src/modules/notifications/notifications.service', () => ({ markOpened: jest.fn(async () => {}) }));

const express = require('express');
const request = require('supertest');
const service = require('../../../src/modules/notifications/notifications.service');
const router = require('../../../src/modules/notifications/notifications.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');

const app = express();
app.use(express.json());
app.use('/v1/notifications', router);
app.use(errorHandler);

beforeEach(() => jest.clearAllMocks());

describe('POST /v1/notifications/:id/opened', () => {
  it('oturumdaki gönüllü adına açılışı kaydeder, 204', async () => {
    const id = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    const res = await request(app).post(`/v1/notifications/${id}/opened`);

    expect(res.status).toBe(204);
    expect(service.markOpened).toHaveBeenCalledWith('u1', id);
  });

  it('uuid olmayan kimlik 400', async () => {
    const res = await request(app).post('/v1/notifications/abc/opened');
    expect(res.status).toBe(400);
    expect(service.markOpened).not.toHaveBeenCalled();
  });
});
