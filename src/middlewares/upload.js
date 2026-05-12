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

function diskStorage(subdir) {
  const target = path.join(env.upload.dir, subdir);
  ensureDir(target);
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, target),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      cb(null, `${Date.now()}-${uuidv4()}${ext}`);
    },
  });
}

function mimeFilter(allowed) {
  return (_req, file, cb) => {
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(errors.validation('Dosya formatı desteklenmiyor', { mimetype: file.mimetype }));
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
}).single('file');

const reportUpload = multer({
  storage: diskStorage('reports'),
  limits: { fileSize: env.upload.maxDocBytes },
  fileFilter: mimeFilter(ALLOWED_DOC_MIME),
}).array('photos', env.upload.maxReportPhotos);

/** Multer hatalarını AppError'a çevirip pipeline'da sürdürür. */
function wrapMulter(handler) {
  return (req, res, next) => {
    handler(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          errors.validation('Dosya boyutu sınırı aşıldı', { limitBytes: err.limit }),
        );
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(errors.validation('Beklenmeyen dosya alanı', { field: err.field }));
      }
      return next(err);
    });
  };
}

module.exports = {
  onboardingUpload: wrapMulter(onboardingUpload),
  avatarUpload: wrapMulter(avatarUpload),
  reportUpload: wrapMulter(reportUpload),
};
