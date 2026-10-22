'use strict';

// Panel uçları: operatör medyası ekleme/silme ve olay zaman çizelgesi.

jest.mock('../../../src/middlewares/auth', () => ({
  requireAdmin: (req, _res, next) => {
    req.panelUser = { id: 'p1', name: 'Ayşe' };
    req.user = { id: 'p1' };
    next();
  },
  requireAuth: (_req, _res, next) => next(),
}));
jest.mock('../../../src/config/redis', () => ({ redis: {} }));
jest.mock('../../../src/middlewares/upload', () => ({
  contentUpload: (_req, _res, next) => next(),
  missionPhotoUpload: jest.fn((req, _res, next) => {
    req.file = { path: '/uploads/missions/a.jpg', mimetype: 'image/jpeg' };
    next();
  }),
}));
jest.mock('../../../src/modules/missions/missions.service', () => ({
  adminAddMedia: jest.fn(async () => ({ id: 'ph1', kind: 'image', status: 'approved' })),
  adminDeleteMedia: jest.fn(async () => {}),
}));
jest.mock('../../../src/modules/missions/missionEvents.service', () => ({
  listForMission: jest.fn(async () => ({ data: [{ id: 'e1', type: 'mission_closed' }] })),
}));

const express = require('express');
const request = require('supertest');
const { errors } = require('../../../src/shared/errors');
const { missionPhotoUpload } = require('../../../src/middlewares/upload');
const missionsService = require('../../../src/modules/missions/missions.service');
const missionEventsService = require('../../../src/modules/missions/missionEvents.service');
const adminRouter = require('../../../src/modules/admin/admin.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');

const app = express();
app.use(express.json());
app.use('/admin', adminRouter);
app.use(errorHandler);

beforeEach(() => jest.clearAllMocks());

describe('POST /admin/missions/:id/media', () => {
  it('olay fotoğrafı yükleme katmanından geçer, 201 ve oluşan öğe döner', async () => {
    const res = await request(app).post('/admin/missions/m1/media');

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'ph1', kind: 'image', status: 'approved' });
    expect(missionPhotoUpload).toHaveBeenCalledTimes(1);
    expect(missionsService.adminAddMedia).toHaveBeenCalledWith(
      'm1',
      { path: '/uploads/missions/a.jpg', mimetype: 'image/jpeg' },
      expect.objectContaining({ userId: 'p1', name: 'Ayşe' }),
    );
  });

  it('yükleme katmanının reddi servise inmez', async () => {
    missionPhotoUpload.mockImplementationOnce((_req, _res, next) =>
      next(errors.make(415, 'unsupported_media_type', 'Dosya formatı desteklenmiyor')),
    );

    const res = await request(app).post('/admin/missions/m1/media');

    expect(res.status).toBe(415);
    expect(missionsService.adminAddMedia).not.toHaveBeenCalled();
  });
});

describe('DELETE /admin/missions/:id/media/:mediaId', () => {
  it('204 döner ve işlemi yapan operatörle çağırır', async () => {
    const res = await request(app).delete('/admin/missions/m1/media/ph1');

    expect(res.status).toBe(204);
    expect(missionsService.adminDeleteMedia).toHaveBeenCalledWith('m1', 'ph1', expect.objectContaining({ userId: 'p1' }));
  });

  it('gönüllü yüklemesi 409 volunteer_media', async () => {
    missionsService.adminDeleteMedia.mockRejectedValueOnce(errors.conflict('x', undefined, 'volunteer_media'));

    const res = await request(app).delete('/admin/missions/m1/media/v1');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('volunteer_media');
  });
});

describe('GET /admin/missions/:id/events', () => {
  it('{ data } zarfıyla döner', async () => {
    const res = await request(app).get('/admin/missions/m1/events');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [{ id: 'e1', type: 'mission_closed' }] });
    expect(missionEventsService.listForMission).toHaveBeenCalledWith('m1');
  });
});
