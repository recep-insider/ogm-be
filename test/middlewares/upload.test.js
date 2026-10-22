'use strict';

jest.mock('../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const { AppError } = require('../../src/shared/errors');
const { __testables } = require('../../src/middlewares/upload');

const { mimeFilter, imageSizeGuard, MIME_TO_EXT, ALLOWED_MEDIA_MIME } = __testables;

// mimeFilter(allowed) → multer fileFilter: (req, file, cb).
// Accept: cb(null, true). Reject: cb(AppError) with a single argument.
function runFilter(allowed, mimetype) {
  return new Promise((resolve) => {
    const filter = mimeFilter(allowed);
    filter({}, { mimetype }, (err, accepted) => resolve({ err, accepted }));
  });
}

describe('upload mimeFilter — media allowlist (fireReport/missionPhoto)', () => {
  it('accepts iOS .mov (video/quicktime) — regression', async () => {
    const { err, accepted } = await runFilter(ALLOWED_MEDIA_MIME, 'video/quicktime');
    expect(err).toBeNull();
    expect(accepted).toBe(true);
  });

  it('accepts video/mp4', async () => {
    const { err, accepted } = await runFilter(ALLOWED_MEDIA_MIME, 'video/mp4');
    expect(err).toBeNull();
    expect(accepted).toBe(true);
  });

  it('accepts image/jpeg', async () => {
    const { err, accepted } = await runFilter(ALLOWED_MEDIA_MIME, 'image/jpeg');
    expect(err).toBeNull();
    expect(accepted).toBe(true);
  });

  it('accepts image/png', async () => {
    const { err, accepted } = await runFilter(ALLOWED_MEDIA_MIME, 'image/png');
    expect(err).toBeNull();
    expect(accepted).toBe(true);
  });

  it('rejects unsupported type (video/x-msvideo) with 415', async () => {
    const { err } = await runFilter(ALLOWED_MEDIA_MIME, 'video/x-msvideo');
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(415);
    expect(err.code).toBe('unsupported_media_type');
    expect(err.details).toEqual({ mimetype: 'video/x-msvideo' });
  });

  it('rejects unsupported type (application/octet-stream) with 415', async () => {
    const { err } = await runFilter(ALLOWED_MEDIA_MIME, 'application/octet-stream');
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(415);
    expect(err.code).toBe('unsupported_media_type');
  });

  // The old allowlist did not include video/quicktime; this constant check
  // turns red on any regression that would drop .mov support again.
  it('ALLOWED_MEDIA_MIME contains video/quicktime', () => {
    expect(ALLOWED_MEDIA_MIME).toContain('video/quicktime');
  });

  // Regression: quicktime allowlist'e girdiğinde MIME_TO_EXT'te karşılığı yoktu,
  // .mov dosyaları diske uzantısız yazılıyordu.
  it('MIME_TO_EXT maps video/quicktime to .mov', () => {
    expect(MIME_TO_EXT['video/quicktime']).toBe('.mov');
  });
});

const MB = 1024 * 1024;

describe('upload imageSizeGuard — fireReport per-type size limit', () => {
  function runGuard(files) {
    return new Promise((resolve) => {
      const guard = imageSizeGuard(10 * MB);
      guard({ files }, {}, (err) => resolve(err));
    });
  }

  it('passes when there are no files', async () => {
    expect(await runGuard(undefined)).toBeUndefined();
    expect(await runGuard([])).toBeUndefined();
  });

  it('passes images at or under the limit', async () => {
    const err = await runGuard([
      { mimetype: 'image/jpeg', size: 10 * MB, path: '/tmp/a.jpg', originalname: 'a.jpg' },
    ]);
    expect(err).toBeUndefined();
  });

  it('does NOT apply the image limit to videos (video multer limitine tabi)', async () => {
    const err = await runGuard([
      { mimetype: 'video/mp4', size: 60 * MB, path: '/tmp/v.mp4', originalname: 'v.mp4' },
      { mimetype: 'video/quicktime', size: 45 * MB, path: '/tmp/v.mov', originalname: 'v.mov' },
    ]);
    expect(err).toBeUndefined();
  });

  it('rejects an oversized image with 413 file_too_large', async () => {
    const err = await runGuard([
      { mimetype: 'video/mp4', size: 60 * MB, path: '/tmp/v.mp4', originalname: 'v.mp4' },
      { mimetype: 'image/png', size: 11 * MB, path: '/tmp/big.png', originalname: 'big.png' },
    ]);
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(413);
    expect(err.code).toBe('file_too_large');
    expect(err.details).toEqual({ limitBytes: 10 * MB, field: 'big.png' });
  });
});

describe('upload imageSizeGuard — tek dosya (req.file)', () => {
  it('tek alanlı yüklemede de büyük görseli 413 ile reddeder, videoyu geçirir', async () => {
    const guard = imageSizeGuard(10 * MB);
    const run = (file) => new Promise((resolve) => guard({ file }, {}, resolve));

    expect(await run({ mimetype: 'video/mp4', size: 40 * MB, path: '/tmp/v.mp4', originalname: 'v.mp4' })).toBeUndefined();
    const err = await run({ mimetype: 'image/jpeg', size: 11 * MB, path: '/tmp/b.jpg', originalname: 'b.jpg' });
    expect(err).toMatchObject({ status: 413, code: 'file_too_large', details: { limitBytes: 10 * MB, field: 'b.jpg' } });
  });
});

describe('olay medyası yükleme limitleri (operatör vs gönüllü)', () => {
  const KB = 1024;
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const express = require('express');
  const request = require('supertest');
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-media-'));
  let app;

  beforeAll(() => {
    jest.isolateModules(() => {
      const env = require('../../src/config/env');
      Object.assign(env.upload, { dir: uploadDir, maxDocBytes: 2 * KB, maxVideoBytes: 8 * KB });
      const { missionMediaUpload, missionPhotoUpload } = require('../../src/middlewares/upload');
      const { errorHandler } = require('../../src/middlewares/error-handler');
      const ok = (req, res) => res.json({ size: req.file.size });
      app = express();
      app.post('/admin-media', missionMediaUpload, ok);
      app.post('/volunteer-photo', missionPhotoUpload, ok);
      app.use(errorHandler);
    });
  });

  afterAll(() => fs.rmSync(uploadDir, { recursive: true, force: true }));

  const send = (url, size, filename, contentType) =>
    request(app).post(url).attach('file', Buffer.alloc(size), { filename, contentType });

  it('operatör görsel limitini aşan videoyu video limitine kadar kabul eder', async () => {
    const res = await send('/admin-media', 5 * KB, 'v.mp4', 'video/mp4');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ size: 5 * KB });
  });

  it('operatör görseli görsel limitine tabidir', async () => {
    const res = await send('/admin-media', 5 * KB, 'b.png', 'image/png');
    expect(res.status).toBe(413);
    expect(res.body.error).toMatchObject({ code: 'file_too_large', details: { limitBytes: 2 * KB } });
  });

  it('video limitini aşan operatör videosu 413', async () => {
    const res = await send('/admin-media', 9 * KB, 'v.mp4', 'video/mp4');
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('file_too_large');
  });

  it('gönüllü yüklemesi değişmedi: video da belge limitine tabidir', async () => {
    const res = await send('/volunteer-photo', 5 * KB, 'v.mp4', 'video/mp4');
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('file_too_large');
    expect((await send('/volunteer-photo', 1 * KB, 'v.mp4', 'video/mp4')).status).toBe(200);
  });
});
