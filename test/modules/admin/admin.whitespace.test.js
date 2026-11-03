'use strict';

// BUG-032: zorunlu metin alanları yalnız boşlukla kaydedilemez (boş push tüm gönüllülere gitti);
// metin alanları kaydedilmeden önce kırpılır. Şifreler kırpılmaz.

jest.mock('../../../src/middlewares/auth', () => ({
  requireAdmin: (_req, _res, next) => next(),
  requireAuth: (_req, _res, next) => next(),
}));
jest.mock('../../../src/middlewares/idempotency', () => ({ idempotent: () => (_req, _res, next) => next() }));
jest.mock('../../../src/modules/notifications/dispatch.service', () => ({
  send: jest.fn(async (body) => ({ ok: true, body })),
  history: jest.fn(),
}));
jest.mock('../../../src/modules/blog/blog.service', () => ({
  ...jest.requireActual('../../../src/modules/blog/blog.service'),
  adminCreate: jest.fn(async (body) => ({ ok: true, body })),
}));
jest.mock('../../../src/modules/missions/missions.service', () => ({
  ...jest.requireActual('../../../src/modules/missions/missions.service'),
  adminCreate: jest.fn(async (body) => ({ ok: true, body })),
}));

const express = require('express');
const request = require('supertest');
const dispatchService = require('../../../src/modules/notifications/dispatch.service');
const blogService = require('../../../src/modules/blog/blog.service');
const missionsService = require('../../../src/modules/missions/missions.service');
const adminRouter = require('../../../src/modules/admin/admin.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');

const app = express();
app.use(express.json());
app.use('/admin', adminRouter);
app.use(errorHandler);

beforeEach(() => jest.clearAllMocks());

describe('admin — yalnız boşluk metin (BUG-032)', () => {
  it.each([
    [{ category: 'bilgi', title: '   ', body: 'Mesaj', audience: 'tumu' }, 'title'],
    [{ category: 'bilgi', title: 'Başlık', body: ' \n\t ', audience: 'tumu' }, 'body'],
  ])('bildirim %p → 400 (%s), gönderilmez', async (payload, field) => {
    const res = await request(app).post('/admin/notifications').send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error.details.errors.map((e) => e.field)).toContain(field);
    expect(dispatchService.send).not.toHaveBeenCalled();
  });

  it('bildirim başlığı ve metni kırpılarak gönderilir', async () => {
    await request(app).post('/admin/notifications').send({ category: 'bilgi', title: '  Duyuru  ', body: ' Metin ', audience: 'tumu' });
    expect(dispatchService.send).toHaveBeenCalledWith(expect.objectContaining({ title: 'Duyuru', body: 'Metin' }), expect.anything());
  });

  it('blog başlığı yalnız boşluksa 400', async () => {
    const res = await request(app).post('/admin/content/blog').send({ title: '    ' });
    expect(res.status).toBe(400);
    expect(blogService.adminCreate).not.toHaveBeenCalled();
  });

  it('olay başlığı yalnız boşluksa 400', async () => {
    const res = await request(app).post('/admin/missions').send({ title: '   ', shortLocation: 'Marmaris' });
    expect(res.status).toBe(400);
    expect(missionsService.adminCreate).not.toHaveBeenCalled();
  });
});
