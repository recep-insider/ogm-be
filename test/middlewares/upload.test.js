'use strict';

const { AppError } = require('../../src/shared/errors');
const { __testables } = require('../../src/middlewares/upload');

const { mimeFilter, ALLOWED_MEDIA_MIME } = __testables;

// mimeFilter(allowed) → multer fileFilter: (req, file, cb).
// Kabul: cb(null, true). Ret: cb(AppError) tek argümanla.
function runFilter(allowed, mimetype) {
  return new Promise((resolve) => {
    const filter = mimeFilter(allowed);
    filter({}, { mimetype }, (err, accepted) => resolve({ err, accepted }));
  });
}

describe('upload mimeFilter — media allowlist (fireReport/missionPhoto)', () => {
  it('iOS .mov (video/quicktime) kabul edilir — regression', async () => {
    const { err, accepted } = await runFilter(ALLOWED_MEDIA_MIME, 'video/quicktime');
    expect(err).toBeNull();
    expect(accepted).toBe(true);
  });

  it('video/mp4 kabul edilir', async () => {
    const { err, accepted } = await runFilter(ALLOWED_MEDIA_MIME, 'video/mp4');
    expect(err).toBeNull();
    expect(accepted).toBe(true);
  });

  it('image/jpeg kabul edilir', async () => {
    const { err, accepted } = await runFilter(ALLOWED_MEDIA_MIME, 'image/jpeg');
    expect(err).toBeNull();
    expect(accepted).toBe(true);
  });

  it('image/png kabul edilir', async () => {
    const { err, accepted } = await runFilter(ALLOWED_MEDIA_MIME, 'image/png');
    expect(err).toBeNull();
    expect(accepted).toBe(true);
  });

  it('desteklenmeyen tip (video/x-msvideo) 415 ile reddedilir', async () => {
    const { err } = await runFilter(ALLOWED_MEDIA_MIME, 'video/x-msvideo');
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(415);
    expect(err.code).toBe('unsupported_media_type');
    expect(err.details).toEqual({ mimetype: 'video/x-msvideo' });
  });

  it('desteklenmeyen tip (application/octet-stream) 415 ile reddedilir', async () => {
    const { err } = await runFilter(ALLOWED_MEDIA_MIME, 'application/octet-stream');
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(415);
    expect(err.code).toBe('unsupported_media_type');
  });

  // Eski allowlist'te video/quicktime yoktu; bu sabit kontrolü, .mov'u
  // tekrar düşürecek bir gerilemede kırmızı verir (regression guard).
  it('ALLOWED_MEDIA_MIME video/quicktime içerir', () => {
    expect(ALLOWED_MEDIA_MIME).toContain('video/quicktime');
  });
});
