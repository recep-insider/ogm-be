'use strict';

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
