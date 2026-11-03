'use strict';

// Şemaya eklenen alanlar (K3, K8, K17, K20) stripUnknown ile düşmeden servise ulaşır.

jest.mock('../../../src/middlewares/auth', () => ({
  requireAdmin: (_req, _res, next) => next(),
  requireAuth: (_req, _res, next) => next(),
}));
jest.mock('../../../src/modules/admin/admin.service', () => ({
  ...jest.requireActual('../../../src/modules/admin/admin.service'),
  listVolunteers: jest.fn(async () => ({ items: [], total: 0 })),
  setCommissionDecision: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../../../src/modules/blog/blog.service', () => ({
  ...jest.requireActual('../../../src/modules/blog/blog.service'),
  adminUpdate: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../../../src/modules/notifications/dispatch.service', () => ({
  ...jest.requireActual('../../../src/modules/notifications/dispatch.service'),
  send: jest.fn(async () => ({ ok: true })),
}));

const express = require('express');
const request = require('supertest');
const adminService = require('../../../src/modules/admin/admin.service');
const blogService = require('../../../src/modules/blog/blog.service');
const dispatchService = require('../../../src/modules/notifications/dispatch.service');
const adminRouter = require('../../../src/modules/admin/admin.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');

const app = express();
app.use(express.json());
app.use('/admin', adminRouter);
app.use(errorHandler);

const NOTIFICATION = { category: 'bilgi', title: 'Duyuru', body: 'Metin', audience: 'tumu' };

beforeEach(() => jest.clearAllMocks());

describe('GET /admin/volunteers — pendingDeletion', () => {
  it('pendingDeletion=true servise boolean true olarak geçer', async () => {
    const res = await request(app).get('/admin/volunteers?pendingDeletion=true');

    expect(res.status).toBe(200);
    expect(adminService.listVolunteers).toHaveBeenCalledWith(expect.objectContaining({ pendingDeletion: true }));
  });
});

describe('POST /admin/volunteers/:userId/commission — expectedDecision', () => {
  it('expectedDecision servise geçer', async () => {
    const res = await request(app)
      .post('/admin/volunteers/u1/commission')
      .send({ decision: 'approved', expectedDecision: 'pending' });

    expect(res.status).toBe(200);
    expect(adminService.setCommissionDecision).toHaveBeenCalledWith(
      'u1',
      { decision: 'approved', expectedDecision: 'pending' },
      expect.anything(),
    );
  });

  it('expectedDecision null servise null olarak geçer', async () => {
    const res = await request(app)
      .post('/admin/volunteers/u1/commission')
      .send({ decision: 'approved', expectedDecision: null });

    expect(res.status).toBe(200);
    expect(adminService.setCommissionDecision).toHaveBeenCalledWith(
      'u1',
      { decision: 'approved', expectedDecision: null },
      expect.anything(),
    );
  });
});

describe('PUT /admin/content/blog/:id — version', () => {
  it('version servise geçer', async () => {
    const res = await request(app).put('/admin/content/blog/b1').send({ title: 'Yeni', version: 3 });

    expect(res.status).toBe(200);
    expect(blogService.adminUpdate).toHaveBeenCalledWith('b1', { title: 'Yeni', version: 3 }, expect.anything());
  });
});

describe('POST /admin/notifications — region', () => {
  it('region servise geçer', async () => {
    const res = await request(app).post('/admin/notifications').send({ ...NOTIFICATION, region: 'ege' });

    expect(res.status).toBe(200);
    expect(dispatchService.send).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'ege' }),
      expect.anything(),
    );
  });

  it('bilinmeyen region 400 döner, gönderim yapılmaz', async () => {
    const res = await request(app).post('/admin/notifications').send({ ...NOTIFICATION, region: 'atlantis' });

    expect(res.status).toBe(400);
    expect(dispatchService.send).not.toHaveBeenCalled();
  });
});
