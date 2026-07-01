'use strict';

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const env = require('../config/env');
const { errors } = require('../shared/errors');

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore — runtime'da log atılır
  }
}

const ALLOWED_DOC_MIME = ['image/jpeg', 'image/png', 'application/pdf'];
const ALLOWED_AVATAR_MIME = ['image/jpeg', 'image/png'];
// video/quicktime: default iOS camera/gallery output (.mov) — app builds that
// don't remux to mp4 send this; rejecting it loses fire reports.
const ALLOWED_MEDIA_MIME = ['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime'];

// Uzantıyı SUNUCU belirler — istemci dosya adı .html/.svg taşısa bile diske
// yalnızca güvenli uzantı yazılır (uploads origin'inde stored-XSS'i engeller).
const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'video/mp4': '.mp4',
};

function diskStorage(subdir) {
  const target = path.join(env.upload.dir, subdir);
  ensureDir(target);
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, target),
    filename: (_req, file, cb) => {
      // mimetype fileFilter'da zaten whitelist'lendi; eşleşmezse uzantısız yaz.
      const ext = MIME_TO_EXT[file.mimetype] || '';
      cb(null, `${Date.now()}-${uuidv4()}${ext}`);
    },
  });
}

function mimeFilter(allowed) {
  return (_req, file, cb) => {
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(errors.make(415, 'unsupported_media_type', 'Dosya formatı desteklenmiyor', {
      mimetype: file.mimetype,
    }));
  };
}

const onboardingUpload = multer({
  storage: diskStorage('onboarding'),
  limits: { fileSize: env.upload.maxDocBytes },
  fileFilter: mimeFilter(ALLOWED_DOC_MIME),
}).fields([
  { name: 'saglikRaporu', maxCount: 1 },
  { name: 'sabikaKaydi', maxCount: 1 },
]);

const avatarUpload = multer({
  storage: diskStorage('avatars'),
  limits: { fileSize: env.upload.maxAvatarBytes },
  fileFilter: mimeFilter(ALLOWED_AVATAR_MIME),
}).single('avatar');

// Yangın ihbarı — `media[]` (min 1, kontrat 9.1). Çoklu image/video.
const fireReportUpload = multer({
  storage: diskStorage('reports'),
  limits: { fileSize: env.upload.maxDocBytes },
  fileFilter: mimeFilter(ALLOWED_MEDIA_MIME),
}).array('media', env.upload.maxReportPhotos);

// Aktif görev fotoğrafı — tek `file` (kontrat 7.5).
const missionPhotoUpload = multer({
  storage: diskStorage('missions'),
  limits: { fileSize: env.upload.maxDocBytes },
  fileFilter: mimeFilter(ALLOWED_MEDIA_MIME),
}).single('file');

/** Multer hatalarını AppError'a çevirip pipeline'da sürdürür. */
function wrapMulter(handler) {
  return (req, res, next) => {
    handler(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          errors.make(413, 'file_too_large', 'Dosya boyutu sınırı aşıldı', {
            limitBytes: err.limit,
          }),
        );
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(errors.validation('Beklenmeyen dosya alanı', { field: err.field }));
      }
      return next(err);
    });
  };
}

// Admin içerik medyası (blog kapak/görsel, eğitim video) — tek `file`.
const ALLOWED_CONTENT_MIME = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'];
const contentUpload = multer({
  storage: diskStorage('content'),
  limits: { fileSize: env.upload.maxDocBytes },
  fileFilter: mimeFilter(ALLOWED_CONTENT_MIME),
}).single('file');

module.exports = {
  onboardingUpload: wrapMulter(onboardingUpload),
  avatarUpload: wrapMulter(avatarUpload),
  fireReportUpload: wrapMulter(fireReportUpload),
  missionPhotoUpload: wrapMulter(missionPhotoUpload),
  contentUpload: wrapMulter(contentUpload),
  // Test-only: exposes mimeFilter and the allowlist constants for unit tests.
  __testables: { mimeFilter, ALLOWED_DOC_MIME, ALLOWED_AVATAR_MIME, ALLOWED_MEDIA_MIME },
};
