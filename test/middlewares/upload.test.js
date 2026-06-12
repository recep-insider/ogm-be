'use strict';

const { AppError } = require('../../src/shared/errors');
const { __testables } = require('../../src/middlewares/upload');

const { mimeFilter, ALLOWED_MEDIA_MIME } = __testables;

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
});
