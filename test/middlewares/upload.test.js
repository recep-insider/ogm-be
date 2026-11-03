'use strict';

jest.mock('../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const { AppError } = require('../../src/shared/errors');
const { __testables } = require('../../src/middlewares/upload');

const { mimeFilter, imageSizeGuard, totalSizeGuard, FIRE_REPORT_TOTAL_BYTES, MIME_TO_EXT, ALLOWED_MEDIA_MIME } = __testables;

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

describe('upload totalSizeGuard — ihbar başına toplam sınır (K9)', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  it('ihbar sınırı 100 MB; nginx gövde sınırının (110 MB) altında', () => {
    expect(FIRE_REPORT_TOTAL_BYTES).toBe(100 * MB);
  });

  it('ihbar yükleme zinciri toplam sınırı uygular', async () => {
    const { fireReportUpload } = require('../../src/middlewares/upload');
    const last = fireReportUpload[fireReportUpload.length - 1];
    const err = await new Promise((resolve) => last({ files: [{ size: 101 * MB }] }, {}, resolve));
    expect(err).toMatchObject({ status: 413, code: 'payload_too_large' });
  });

  it('toplam sınırın altındaki dosyaları geçirir', async () => {
    const guard = totalSizeGuard(100 * MB);
    const err = await new Promise((resolve) => guard({
      files: [{ size: 60 * MB, path: '/tmp/a' }, { size: 40 * MB, path: '/tmp/b' }],
    }, {}, resolve));
    expect(err).toBeUndefined();
  });

  it('toplam sınırı aşınca 413 payload_too_large döner ve yüklenen dosyalar silinir', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'total-size-'));
    const files = ['a.mp4', 'b.mp4'].map((name) => {
      const p = path.join(dir, name);
      fs.writeFileSync(p, 'x');
      return { size: 60 * MB, path: p, originalname: name };
    });
    const guard = totalSizeGuard(100 * MB);

    const err = await new Promise((resolve) => guard({ files }, {}, resolve));

    expect(err).toMatchObject({ status: 413, code: 'payload_too_large', details: { limitBytes: 100 * MB, totalBytes: 120 * MB } });
    await new Promise((r) => setTimeout(r, 50));
    expect(files.some((f) => fs.existsSync(f.path))).toBe(false);
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

describe('wrapMulter — sınır ve multer hataları (BUG-043, BUG-049)', () => {
  const express = require('express');
  const multer = require('multer');
  const request = require('supertest');
  const { errorHandler } = require('../../src/middlewares/error-handler');
  const { wrapMulter, sizeLimit } = __testables;

  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { ...sizeLimit(10), fieldSize: 5 } }).single('file');
  app.post('/u', wrapMulter(upload, 10), (req, res) => res.json({ size: req.file && req.file.size }));
  app.use(errorHandler);

  it('tam sınırdaki dosya kabul edilir', async () => {
    const res = await request(app).post('/u').attach('file', Buffer.alloc(10, 'a'), 'a.png');
    expect(res.status).toBe(200);
    expect(res.body.size).toBe(10);
  });

  it('sınırı bir bayt aşan dosya 413, sınır yanıtta', async () => {
    const res = await request(app).post('/u').attach('file', Buffer.alloc(11, 'a'), 'a.png');
    expect(res.status).toBe(413);
    expect(res.body.error).toMatchObject({ code: 'file_too_large', details: { limitBytes: 10 } });
  });

  it.each([
    ['sınırı aşan alan değeri', (r) => r.field('x', 'abcdefghij')],
    ['boundary olmayan multipart', (r) => r.set('Content-Type', 'multipart/form-data').send('abc')],
    ['yarıda kesilen multipart', (r) => r.set('Content-Type', 'multipart/form-data; boundary=xx')
      .send('--xx\r\nContent-Disposition: form-data; name="file"; filename="a"\r\n\r\nabc')],
  ])('%s 400', async (_name, build) => {
    const res = await build(request(app).post('/u'));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('dosya sistemi hatası 500 kalır', async () => {
    const failing = (_req, _res, cb) => cb(Object.assign(new Error('ENOSPC'), { code: 'ENOSPC', syscall: 'write' }));
    const next = jest.fn();
    wrapMulter(failing, 10)({}, {}, next);
    expect(next.mock.calls[0][0].syscall).toBe('write');
  });
});
