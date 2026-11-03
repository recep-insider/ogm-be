'use strict';

jest.mock('../../../src/middlewares/auth', () => ({
  requireAdmin: (_req, _res, next) => next(),
  requireAuth: (_req, _res, next) => next(),
}));
jest.mock('../../../src/middlewares/idempotency', () => ({ idempotent: () => (_req, _res, next) => next() }));
jest.mock('../../../src/modules/admin/admin.service', () => ({
  ...jest.requireActual('../../../src/modules/admin/admin.service'),
  setApplicationStatus: jest.fn(async () => ({ ok: true })),
  listVolunteers: jest.fn(async () => ({ items: [] })),
  setCommissionDecision: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../../../src/modules/sos/sos.service', () => ({
  ...jest.requireActual('../../../src/modules/sos/sos.service'),
  adminAddHistory: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../../../src/modules/blog/blog.service', () => ({
  ...jest.requireActual('../../../src/modules/blog/blog.service'),
  adminCreate: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../../../src/modules/equipment/equipment.service', () => ({
  ...jest.requireActual('../../../src/modules/equipment/equipment.service'),
  deliverKkdSet: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../../../src/modules/trainings/trainings.service', () => ({
  ...jest.requireActual('../../../src/modules/trainings/trainings.service'),
  adminSaveAttendance: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../../../src/modules/missions/missions.service', () => ({
  ...jest.requireActual('../../../src/modules/missions/missions.service'),
  adminCreate: jest.fn(async () => ({ ok: true })),
  adminUpdate: jest.fn(async () => ({ ok: true })),
}));

const express = require('express');
const request = require('supertest');
const adminService = require('../../../src/modules/admin/admin.service');
const sosService = require('../../../src/modules/sos/sos.service');
const blogService = require('../../../src/modules/blog/blog.service');
const equipmentService = require('../../../src/modules/equipment/equipment.service');
const trainingsService = require('../../../src/modules/trainings/trainings.service');
const missionsService = require('../../../src/modules/missions/missions.service');
const adminRouter = require('../../../src/modules/admin/admin.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');

const app = express();
app.use(express.json());
app.use('/admin', adminRouter);
app.use(errorHandler);

beforeEach(() => jest.clearAllMocks());

describe('admin — isteğe bağlı metin alanları kırpılır', () => {
  it('başvuru durumu notu', async () => {
    const res = await request(app).put('/admin/users/u1/application').send({ status: adminService.APPLICATION_STATUSES[0], note: '  Not  ' });
    expect(res.status).toBe(200);
    expect(adminService.setApplicationStatus).toHaveBeenCalledWith('u1', expect.objectContaining({ note: 'Not' }), expect.anything());
  });

  it('gönüllü arama sorgusu', async () => {
    const res = await request(app).get('/admin/volunteers').query({ q: '  Ayşe  ' });
    expect(res.status).toBe(200);
    expect(adminService.listVolunteers).toHaveBeenCalledWith(expect.objectContaining({ q: 'Ayşe' }));
  });

  it('SOS geçmiş notu (yazan oturumdaki kullanıcıdır, gövdedeki by düşer — BUG-060)', async () => {
    const res = await request(app).post('/admin/sos-reports/s1/history').send({ note: '  Ulaşıldı  ', by: ' Operatör ' });
    expect(res.status).toBe(200);
    expect(sosService.adminAddHistory).toHaveBeenCalledWith('s1', { note: 'Ulaşıldı' }, expect.anything());
  });

  it('blog açıklaması ve yazar alanları', async () => {
    const res = await request(app)
      .post('/admin/content/blog')
      .send({ title: 'Başlık', description: '  Özet  ', authorName: ' Ali ', authorRole: '  Editör ' });
    expect(res.status).toBe(200);
    expect(blogService.adminCreate).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Özet', authorName: 'Ali', authorRole: 'Editör' }),
      expect.anything(),
    );
  });

  it('komisyon kararı alanları', async () => {
    const res = await request(app)
      .post('/admin/volunteers/u1/commission')
      .send({ decision: 'approved', decidedBy: ' Kurul ', decisionNo: '  2026/12 ', note: ' Uygun  ' });
    expect(res.status).toBe(200);
    expect(adminService.setCommissionDecision).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ decidedBy: 'Kurul', decisionNo: '2026/12', note: 'Uygun' }),
      expect.anything(),
    );
  });

  it('KKD seri numarası', async () => {
    const res = await request(app).post('/admin/volunteers/u1/kkd').send({ serials: { kask: '  SN-1  ' } });
    expect(res.status).toBe(200);
    expect(equipmentService.deliverKkdSet).toHaveBeenCalledWith('u1', expect.objectContaining({ serials: { kask: 'SN-1' } }), expect.anything());
  });

  it('yoklama satırındaki userId', async () => {
    const res = await request(app)
      .put('/admin/trainings/saha/t1/attendance')
      .send({ entries: [{ userId: '  u1  ', attended: true }] });
    expect(res.status).toBe(200);
    expect(trainingsService.adminSaveAttendance).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ entries: [{ userId: 'u1', attended: true }] }),
      expect.anything(),
    );
  });

  const locationFields = { il: '  Muğla ', ilce: ' Marmaris  ', regionLabel: '  Ege ', locationLabel: ' Orman içi  ' };
  const trimmedLocation = { il: 'Muğla', ilce: 'Marmaris', regionLabel: 'Ege', locationLabel: 'Orman içi' };

  it('olay oluşturmada il, ilçe ve etiketler', async () => {
    const res = await request(app)
      .post('/admin/missions')
      .send({
        title: 'Yangın',
        shortLocation: 'Marmaris',
        coordinates: { lat: 36.8, lng: 28.2 },
        assemblyPoint: { name: 'Meydan', coordinates: { lat: 36.8, lng: 28.2 } },
        ...locationFields,
      });
    expect(res.status).toBe(200);
    expect(missionsService.adminCreate).toHaveBeenCalledWith(expect.objectContaining(trimmedLocation), expect.anything());
  });

  it('olay güncellemede il, ilçe ve etiketler', async () => {
    const res = await request(app).patch('/admin/missions/m1').send(locationFields);
    expect(res.status).toBe(200);
    expect(missionsService.adminUpdate).toHaveBeenCalledWith('m1', expect.objectContaining(trimmedLocation), expect.anything());
  });
});
