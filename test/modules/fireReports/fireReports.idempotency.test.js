'use strict';

// Misafir ihbarı Idempotency-Key ile tekrar edilirse ikinci kez kaydedilmez; 5xx sonrası aynı anahtarla tekrar işlenir.

jest.mock('../../../src/middlewares/auth', () => ({
  optionalAuth: (_req, _res, next) => next(),
}));
jest.mock('../../../src/config/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));
jest.mock('../../../src/config/redis', () => {
  const store = new Map();
  return {
    redis: {
      store,
      set: jest.fn(async (key, value, ...args) => {
        if (args.includes('NX') && store.has(key)) return null;
        store.set(key, value);
        return 'OK';
      }),
      get: jest.fn(async (key) => store.get(key) ?? null),
      del: jest.fn(async (key) => (store.delete(key) ? 1 : 0)),
      expire: jest.fn(async () => 1),
    },
  };
});
jest.mock('../../../src/middlewares/upload', () => ({
  fireReportUpload: (req, _res, next) => {
    req.body = { data: '{"coordinates":{"lat":36.85,"lng":28.27}}' };
    req.files = [
      { fieldname: 'media', originalname: 'a.jpg', size: 3 },
      { fieldname: 'media', originalname: 'b.jpg', size: 4 },
    ];
    next();
  },
}));
jest.mock('../../../src/modules/fireReports/fireReports.controller', () => ({
  create: jest.fn(async (_req, res) => res.status(201).json({ ok: true, report: { id: 'r1' } })),
}));

const express = require('express');
const request = require('supertest');
const { redis } = require('../../../src/config/redis');
const controller = require('../../../src/modules/fireReports/fireReports.controller');
const router = require('../../../src/modules/fireReports/fireReports.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');

const app = express();
app.use('/fire-reports', router);
app.use(errorHandler);

const flush = () => new Promise((done) => setImmediate(done));
const post = () => request(app).post('/fire-reports').set('Idempotency-Key', 'k-1');

beforeEach(() => {
  jest.clearAllMocks();
  redis.store.clear();
});

describe('POST /fire-reports — Idempotency-Key', () => {
  it('misafir aynı anahtar ve aynı media[] ile iki kez gönderirse ihbar bir kez kaydedilir', async () => {
    const first = await post();
    await flush();
    const second = await post();

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(controller.create).toHaveBeenCalledTimes(1);
  });

  it('ilk deneme 5xx alırsa aynı anahtarla tekrar deneme işlenir', async () => {
    controller.create.mockImplementationOnce(async () => {
      throw new Error('veritabanı düştü');
    });
    const failed = await post();
    await flush();
    const retry = await post();

    expect(failed.status).toBe(500);
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
    expect(controller.create).toHaveBeenCalledTimes(2);
  });
});
