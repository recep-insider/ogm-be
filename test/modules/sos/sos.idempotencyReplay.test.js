'use strict';

jest.mock('../../../src/middlewares/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: req.headers['x-test-user'] };
    next();
  },
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
jest.mock('../../../src/modules/sos/sos.service', () => {
  let n = 0;
  return {
    create: jest.fn(async ({ userId }) => {
      n += 1;
      return { ok: true, sosId: `s${n}`, status: 'active', userId };
    }),
  };
});

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

const flush = () => new Promise((done) => setImmediate(done));
const post = (user) => request(app).post('/sos').set('x-test-user', user).set('Idempotency-Key', 'k-1').send({});

beforeEach(() => {
  jest.clearAllMocks();
  redis.store.clear();
});

describe('POST /sos — aynı anahtarla tekrar', () => {
  it('aynı gönüllü iki kez gönderirse çağrı bir kez açılır, ikinci yanıt tekrar oynatılır', async () => {
    const first = await post('u1');
    await flush();
    const second = await post('u1');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(service.create).toHaveBeenCalledTimes(1);
  });

  it('başka gönüllü aynı anahtarı kullanırsa ilk gönüllünün yanıtını almaz, kendi çağrısı açılır', async () => {
    const first = await post('u1');
    await flush();
    const other = await post('u2');

    expect(other.status).toBe(200);
    expect(other.headers['idempotent-replayed']).toBeUndefined();
    expect(other.body.userId).toBe('u2');
    expect(other.body.sosId).not.toBe(first.body.sosId);
    expect(service.create).toHaveBeenCalledTimes(2);
  });

  it('ilk deneme 5xx alırsa aynı anahtarla tekrar deneme işlenir', async () => {
    service.create.mockImplementationOnce(async () => {
      throw new Error('veritabanı düştü');
    });
    const failed = await post('u1');
    await flush();
    const retry = await post('u1');

    expect(failed.status).toBe(500);
    expect(retry.status).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
    expect(service.create).toHaveBeenCalledTimes(2);
  });
});
