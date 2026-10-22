'use strict';

// Eğitim içerik alanlarının sınır doğrulaması (kapak, açıklama, içerik blokları, .mp4 video)
// ve tüm saha eğitimlerinin başvurularını tek istekte dönen toplu uç.

jest.mock('../../../src/middlewares/auth', () => ({
  requireAdmin: (_req, _res, next) => next(),
  requireAuth: (_req, _res, next) => next(),
}));
jest.mock('../../../src/modules/trainings/trainings.service', () => ({
  adminCreateOnline: jest.fn(async (body) => ({ id: 'o1', ...body })),
  adminUpdateOnline: jest.fn(async (id, body) => ({ id, ...body })),
  adminCreateSaha: jest.fn(async (body) => ({ id: 's1', ...body })),
  adminUpdateSaha: jest.fn(async (id, body) => ({ id, ...body })),
  adminListAllSahaApplications: jest.fn(async (q) => ({ items: [], total: 0, page: q.page, pageSize: q.pageSize })),
  adminListSahaApplications: jest.fn(async () => ({ items: [] })),
}));

const express = require('express');
const request = require('supertest');
const trainingsService = require('../../../src/modules/trainings/trainings.service');
const adminRouter = require('../../../src/modules/admin/admin.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');

const app = express();
app.use(express.json());
app.use('/admin', adminRouter);
app.use(errorHandler);

const onlineBody = { title: 'Teorik', durationMin: 45 };
const BLOCKS = [
  { type: 'heading', text: 'Başlık' },
  { type: 'paragraph', text: 'Metin' },
  { type: 'image', source: 'content/a.jpg', caption: 'Görsel' },
  { type: 'video', source: 'https://cdn.example/v.mp4?sig=abc', caption: 'Video' },
];

beforeEach(() => jest.clearAllMocks());

describe('theory training content fields', () => {
  it('passes coverPath and content through on POST', async () => {
    const res = await request(app)
      .post('/admin/trainings/online')
      .send({ ...onlineBody, coverPath: 'content/k.jpg', content: BLOCKS });

    expect(res.status).toBe(200);
    const [body] = trainingsService.adminCreateOnline.mock.calls[0];
    expect(body.coverPath).toBe('content/k.jpg');
    expect(body.content).toEqual(BLOCKS);
  });

  it('accepts null coverPath and an empty content list on PUT so the panel can clear them', async () => {
    const res = await request(app).put('/admin/trainings/online/o1').send({ coverPath: null, content: [] });

    expect(res.status).toBe(200);
    expect(trainingsService.adminUpdateOnline).toHaveBeenCalledWith('o1', { coverPath: null, content: [] }, expect.anything());
  });

  it.each([
    'content/1718-uuid.mp4',
    'https://cdn.example/v.MP4',
    'https://cdn.example/v.mp4?v=4be1f0c9',
    'https://cdn.example/v.mp4#t=10',
  ])('accepts the .mp4 videoPath %s', async (videoPath) => {
    const res = await request(app).put('/admin/trainings/online/o1').send({ videoPath });

    expect(res.status).toBe(200);
  });

  it.each([
    'content/v.mov',
    'https://cdn.example/v.webm',
    'https://cdn.example/watch.php?file=v.mp4',
    'https://cdn.example/v.mp4.html',
    'content/v mp4.mp4 x',
  ])('rejects the non-.mp4 videoPath %s with a Turkish message', async (videoPath) => {
    const res = await request(app).put('/admin/trainings/online/o1').send({ videoPath });

    expect(res.status).toBe(400);
    expect(res.body.error.details.errors).toContainEqual({ field: 'videoPath', message: 'Yalnızca .mp4 video eklenebilir' });
    expect(trainingsService.adminUpdateOnline).not.toHaveBeenCalled();
  });

  it('still accepts an empty or null videoPath to clear the video', async () => {
    expect((await request(app).put('/admin/trainings/online/o1').send({ videoPath: '' })).status).toBe(200);
    expect((await request(app).put('/admin/trainings/online/o1').send({ videoPath: null })).status).toBe(200);
  });

  it('rejects a videoPath longer than the 500-character column', async () => {
    const res = await request(app)
      .put('/admin/trainings/online/o1')
      .send({ videoPath: `content/${'a'.repeat(489)}.mp4` });

    expect(res.status).toBe(400);
  });

  it('rejects a coverPath longer than 512 characters', async () => {
    const res = await request(app).put('/admin/trainings/online/o1').send({ coverPath: 'a'.repeat(513) });

    expect(res.status).toBe(400);
  });
});

describe('content block validation', () => {
  const put = (content) => request(app).put('/admin/trainings/online/o1').send({ content });

  it('rejects a video block whose source is not .mp4, ignoring the query string', async () => {
    const res = await put([{ type: 'video', source: 'https://cdn.example/play.php?f=a.mp4' }]);

    expect(res.status).toBe(400);
    expect(res.body.error.details.errors).toContainEqual({ field: 'content.0.source', message: 'Yalnızca .mp4 video eklenebilir' });
  });

  it('rejects image and video blocks without a source', async () => {
    expect((await put([{ type: 'image', caption: 'x' }])).status).toBe(400);
    expect((await put([{ type: 'video' }])).status).toBe(400);
  });

  it('rejects a source on a text block and an unknown block type', async () => {
    expect((await put([{ type: 'paragraph', text: 'x', source: 'content/a.jpg' }])).status).toBe(400);
    expect((await put([{ type: 'embed', source: 'https://x.example' }])).status).toBe(400);
  });

  it('enforces the text, caption and block-count limits', async () => {
    expect((await put([{ type: 'paragraph', text: 'x'.repeat(5001) }])).status).toBe(400);
    expect((await put([{ type: 'image', source: 'content/a.jpg', caption: 'x'.repeat(301) }])).status).toBe(400);
    expect((await put(Array.from({ length: 101 }, () => ({ type: 'paragraph', text: 'x' })))).status).toBe(400);
    expect((await put(Array.from({ length: 100 }, () => ({ type: 'paragraph', text: 'x' })))).status).toBe(200);
  });

  it('rejects content that is not a list of blocks', async () => {
    expect((await put('[{"type":"paragraph"}]')).status).toBe(400);
    expect((await put({ type: 'paragraph', text: 'x' })).status).toBe(400);
  });

  it('drops panel-only keys from blocks instead of storing them', async () => {
    const res = await put([{ id: 'be-1', type: 'paragraph', text: 'x', beType: 'paragraph' }]);

    expect(res.status).toBe(200);
    expect(trainingsService.adminUpdateOnline.mock.calls[0][1].content).toEqual([{ type: 'paragraph', text: 'x' }]);
  });
});

describe('field training content fields', () => {
  const sahaBody = {
    title: 'Saha', location: 'Kamp', startDate: '2030-01-01', startTime: '09:00', endTime: '17:00',
    instructorName: 'Eğitmen', totalSeats: 20,
  };

  it('passes description and content through on POST and PUT', async () => {
    const created = await request(app)
      .post('/admin/trainings/saha')
      .send({ ...sahaBody, description: 'Açıklama', content: BLOCKS });
    const updated = await request(app).put('/admin/trainings/saha/s1').send({ description: '', content: [] });

    expect(created.status).toBe(200);
    expect(updated.status).toBe(200);
    expect(trainingsService.adminCreateSaha.mock.calls[0][0]).toMatchObject({ description: 'Açıklama', content: BLOCKS });
    expect(trainingsService.adminUpdateSaha).toHaveBeenCalledWith('s1', { description: '', content: [] }, expect.anything());
  });

  it('rejects a description longer than 2000 characters and a non-.mp4 video block', async () => {
    expect((await request(app).put('/admin/trainings/saha/s1').send({ description: 'x'.repeat(2001) })).status).toBe(400);
    expect(
      (await request(app).put('/admin/trainings/saha/s1').send({ content: [{ type: 'video', source: 'content/v.mov' }] })).status,
    ).toBe(400);
    expect(trainingsService.adminUpdateSaha).not.toHaveBeenCalled();
  });
});

describe('GET /admin/trainings/saha/applications', () => {
  it('answers from the bulk list with the default page, not the per-training list', async () => {
    const res = await request(app).get('/admin/trainings/saha/applications');

    expect(res.status).toBe(200);
    expect(trainingsService.adminListAllSahaApplications).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(trainingsService.adminListSahaApplications).not.toHaveBeenCalled();
  });

  it('passes status, page and pageSize through', async () => {
    const res = await request(app)
      .get('/admin/trainings/saha/applications')
      .query({ status: 'approved', page: 2, pageSize: 100 });

    expect(res.status).toBe(200);
    expect(trainingsService.adminListAllSahaApplications).toHaveBeenCalledWith({ status: 'approved', page: 2, pageSize: 100 });
  });

  it('rejects an unknown status and a pageSize above 100', async () => {
    expect((await request(app).get('/admin/trainings/saha/applications').query({ status: 'kayitli' })).status).toBe(400);
    expect((await request(app).get('/admin/trainings/saha/applications').query({ pageSize: 101 })).status).toBe(400);
    expect(trainingsService.adminListAllSahaApplications).not.toHaveBeenCalled();
  });

  it('keeps the per-training list working', async () => {
    const res = await request(app).get('/admin/trainings/saha/s1/applications');

    expect(res.status).toBe(200);
    expect(trainingsService.adminListSahaApplications).toHaveBeenCalledWith('s1', {});
  });
});
