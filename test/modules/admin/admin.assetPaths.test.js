'use strict';

// Blog ve eğitim içerik yolu alanları KVKK belgesine (onboarding/) ya da yükleme kökü dışına işaret edemez.

jest.mock('../../../src/middlewares/auth', () => ({
  requireAdmin: (_req, _res, next) => next(),
  requireAuth: (_req, _res, next) => next(),
}));
jest.mock('../../../src/modules/blog/blog.service', () => ({
  adminCreate: jest.fn(async (body) => ({ id: 'b1', ...body })),
  adminUpdate: jest.fn(async (id, body) => ({ id, ...body })),
}));
jest.mock('../../../src/modules/trainings/trainings.service', () => ({
  adminCreateOnline: jest.fn(async (body) => ({ id: 'o1', ...body })),
  adminUpdateSaha: jest.fn(async (id, body) => ({ id, ...body })),
}));

const express = require('express');
const request = require('supertest');
const blogService = require('../../../src/modules/blog/blog.service');
const trainingsService = require('../../../src/modules/trainings/trainings.service');
const adminRouter = require('../../../src/modules/admin/admin.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');

const app = express();
app.use(express.json());
app.use('/admin', adminRouter);
app.use(errorHandler);

const BAD = ['onboarding/saglik.pdf', 'content/%2e%2e/onboarding/x.pdf'];

beforeEach(() => jest.clearAllMocks());

describe('blog kapak ve blok kaynağı', () => {
  it.each(BAD)('POST ve PUT /admin/content/blog kapak yolu %s ise 400, servis çağrılmaz', async (bad) => {
    const created = await request(app).post('/admin/content/blog').send({ title: 'Yazı', coverPath: bad });
    const updated = await request(app).put('/admin/content/blog/b1').send({ coverPath: bad });

    expect(created.status).toBe(400);
    expect(updated.status).toBe(400);
    expect(blogService.adminCreate).not.toHaveBeenCalled();
    expect(blogService.adminUpdate).not.toHaveBeenCalled();
  });

  it('görsel blok kaynağı onboarding/ altındaysa 400, servis çağrılmaz', async () => {
    const res = await request(app)
      .post('/admin/content/blog')
      .send({ title: 'Yazı', content: [{ type: 'image', source: 'onboarding/x.pdf' }] });

    expect(res.status).toBe(400);
    expect(blogService.adminCreate).not.toHaveBeenCalled();
  });

  it('içerik klasöründeki kapak ve blok kaynağı servise iner', async () => {
    const res = await request(app)
      .post('/admin/content/blog')
      .send({ title: 'Yazı', coverPath: 'content/k.jpg', content: [{ type: 'image', source: 'content/a.jpg' }] });

    expect(res.status).toBe(200);
    expect(blogService.adminCreate).toHaveBeenCalledTimes(1);
  });
});

describe('teorik eğitim videoPath', () => {
  const onlineBody = { title: 'Teorik', durationMin: 45 };

  it.each(['onboarding/x.mp4', '../x.mp4'])('%s 400 alır', async (videoPath) => {
    const res = await request(app).post('/admin/trainings/online').send({ ...onlineBody, videoPath });

    expect(res.status).toBe(400);
    expect(trainingsService.adminCreateOnline).not.toHaveBeenCalled();
  });

  it('videos/t1.mp4 kabul edilir', async () => {
    const res = await request(app).post('/admin/trainings/online').send({ ...onlineBody, videoPath: 'videos/t1.mp4' });

    expect(res.status).toBe(200);
    expect(trainingsService.adminCreateOnline.mock.calls[0][0].videoPath).toBe('videos/t1.mp4');
  });
});

describe('saha eğitimi coverPath', () => {
  it('onboarding/ altındaki kapak 400 alır, servis çağrılmaz', async () => {
    const res = await request(app).put('/admin/trainings/saha/s1').send({ coverPath: 'onboarding/x.pdf' });

    expect(res.status).toBe(400);
    expect(trainingsService.adminUpdateSaha).not.toHaveBeenCalled();
  });

  it('içerik klasöründeki kapak kabul edilir', async () => {
    const res = await request(app).put('/admin/trainings/saha/s1').send({ coverPath: 'content/k.jpg' });

    expect(res.status).toBe(200);
    expect(trainingsService.adminUpdateSaha).toHaveBeenCalledWith('s1', { coverPath: 'content/k.jpg' }, expect.anything());
  });
});
