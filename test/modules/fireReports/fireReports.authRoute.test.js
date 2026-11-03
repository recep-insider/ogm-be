'use strict';

// BUG-027: geçersiz/süresi dolmuş token'la gönderilen ihbar sessizce anonim kaydedilmez.

jest.mock('../../../src/middlewares/auth', () => ({
  requireAuth: (req, _res, next) => {
    if (req.headers.authorization === 'Bearer gecerli') {
      req.user = { id: 'u1' };
      return next();
    }
    const { errors } = require('../../../src/shared/errors');
    return next(errors.unauthorized('Geçersiz veya süresi dolmuş token'));
  },
}));
jest.mock('../../../src/middlewares/upload', () => ({
  fireReportUpload: jest.fn((req, _res, next) => next()),
}));
jest.mock('../../../src/middlewares/idempotency', () => ({ idempotent: () => (_req, _res, next) => next() }));
jest.mock('../../../src/modules/fireReports/fireReports.controller', () => ({
  create: jest.fn(async (req, res) => res.status(201).json({ ok: true, userId: req.user?.id || null })),
}));

const express = require('express');
const request = require('supertest');
const { fireReportUpload } = require('../../../src/middlewares/upload');
const controller = require('../../../src/modules/fireReports/fireReports.controller');
const router = require('../../../src/modules/fireReports/fireReports.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');

const app = express();
app.use('/fire-reports', router);
app.use(errorHandler);

beforeEach(() => jest.clearAllMocks());

describe('POST /fire-reports — kimlik', () => {
  it('token yoksa misafir ihbarı kaydedilir', async () => {
    const res = await request(app).post('/fire-reports');
    expect(res.status).toBe(201);
    expect(res.body.userId).toBeNull();
  });

  it('geçerli token ihbarı gönüllüye bağlar', async () => {
    const res = await request(app).post('/fire-reports').set('Authorization', 'Bearer gecerli');
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe('u1');
  });

  it('geçersiz ya da süresi dolmuş token 401; dosya yüklenmez, ihbar kaydedilmez', async () => {
    const res = await request(app).post('/fire-reports').set('Authorization', 'Bearer suresi-dolmus');

    expect(res.status).toBe(401);
    expect(fireReportUpload).not.toHaveBeenCalled();
    expect(controller.create).not.toHaveBeenCalled();
  });
});
