'use strict';

// Operatör medya yüklemesi Idempotency-Key ile tekrar edilirse servise ikinci kez inmez.

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
      expire: jest.fn(async () => 1),
    },
  };
});
const mockUploaded = [];
jest.mock('../../../src/middlewares/upload', () => ({
  contentUpload: (_req, _res, next) => next(),
  missionMediaUpload: (req, _res, next) => {
    const mockFs = require('fs');
    const mockPath = require('path');
    const p = mockPath.join(mockFs.mkdtempSync(mockPath.join(require('os').tmpdir(), 'media-')), 'a.jpg');
    mockFs.writeFileSync(p, 'xyz');
    req.file = { path: p, fieldname: 'file', originalname: 'a.jpg', size: 3, mimetype: 'image/jpeg' };
    mockUploaded.push(p);
    next();
  },
}));
jest.mock('../../../src/modules/missions/missions.service', () => ({
  adminAddMedia: jest.fn(async () => ({ id: 'ph1', kind: 'image', status: 'approved' })),
}));

const fs = require('fs');
const express = require('express');
const request = require('supertest');
const missionsService = require('../../../src/modules/missions/missions.service');
const adminRouter = require('../../../src/modules/admin/admin.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');

const app = express();
app.use(express.json());
app.use('/admin', adminRouter);
app.use(errorHandler);

const flush = () => new Promise((done) => setImmediate(done));

describe('POST /admin/missions/:id/media — Idempotency-Key', () => {
  it('aynı anahtar ve dosyayla ikinci yükleme servise inmez, tekrar oynatılır ve kopyası silinir', async () => {
    const first = await request(app).post('/admin/missions/m1/media').set('Idempotency-Key', 'k-1');
    await flush();
    const second = await request(app).post('/admin/missions/m1/media').set('Idempotency-Key', 'k-1');
    await new Promise((done) => setTimeout(done, 50));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(missionsService.adminAddMedia).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(mockUploaded[0])).toBe(true);
    expect(fs.existsSync(mockUploaded[1])).toBe(false);
  });
});
