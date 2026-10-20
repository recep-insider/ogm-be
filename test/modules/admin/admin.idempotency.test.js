'use strict';

// Panel Idempotency-Key gönderir; aynı anahtarla tekrar eden oluşturma/gönderim servise ikinci kez inmez.

jest.mock('../../../src/middlewares/auth', () => ({
  requireAdmin: (req, _res, next) => {
    req.panelUser = { id: 'p1', name: 'Ayşe' };
    req.user = { id: 'p1' };
    next();
  },
  requireAuth: (_req, _res, next) => next(),
}));
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
    },
  };
});
jest.mock('../../../src/modules/missions/missions.service', () => ({
  adminCreate: jest.fn(async () => ({ ok: true, missionId: 'm1', status: 'active', called: false })),
}));
jest.mock('../../../src/modules/notifications/dispatch.service', () => ({
  send: jest.fn(async () => ({ ok: true, notificationId: 'n1' })),
}));

const express = require('express');
const request = require('supertest');
const { redis } = require('../../../src/config/redis');
const missionsService = require('../../../src/modules/missions/missions.service');
const dispatchService = require('../../../src/modules/notifications/dispatch.service');
const adminRouter = require('../../../src/modules/admin/admin.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');

const flush = () => new Promise((done) => setImmediate(done));

describe('Idempotency-Key on admin create routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
  app.use(errorHandler);

  beforeEach(() => {
    jest.clearAllMocks();
    redis.store.clear();
  });

  it.each([
    ['/admin/missions', {
      title: 'Yangın',
      shortLocation: 'Manavgat',
      coordinates: { lat: 36.8, lng: 31.4 },
      assemblyPoint: { name: 'Meydan', coordinates: { lat: 36.8, lng: 31.4 } },
    }, () => missionsService.adminCreate],
    ['/admin/notifications', {
      category: 'bilgi',
      title: 'Duyuru',
      body: 'Metin',
      audience: 'tumu',
    }, () => dispatchService.send],
  ])('POST %s tekrarında servis bir kez çağrılır', async (path, body, service) => {
    const first = await request(app).post(path).set('Idempotency-Key', 'k-1').send(body);
    await flush();
    const second = await request(app).post(path).set('Idempotency-Key', 'k-1').send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(service()).toHaveBeenCalledTimes(1);
    expect([...redis.store.keys()]).toEqual([`idem:p1:POST:${path}:k-1`]);
  });

  it('geçersiz gövde anahtarı tüketmez', async () => {
    const res = await request(app).post('/admin/notifications').set('Idempotency-Key', 'k-1').send({});

    expect(res.status).toBe(400);
    expect(redis.set).not.toHaveBeenCalled();
  });
});
