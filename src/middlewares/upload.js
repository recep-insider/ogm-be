'use strict';

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const env = require('../config/env');
const { AppError, errors } = require('../shared/errors');
const { discardUploads } = require('../shared/discard-uploads');

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
  'video/quicktime': '.mov',
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

// busboy dosya tam sınıra ulaştığında da keser; sınırdaki dosya kabul edilsin diye bir bayt fazlası verilir.
const sizeLimit = (bytes) => ({ fileSize: bytes + 1 });

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
  limits: sizeLimit(env.upload.maxDocBytes),
  fileFilter: mimeFilter(ALLOWED_DOC_MIME),
}).fields([
  { name: 'saglikRaporu', maxCount: 1 },
  { name: 'sabikaKaydi', maxCount: 1 },
]);

const avatarUpload = multer({
  storage: diskStorage('avatars'),
  limits: sizeLimit(env.upload.maxAvatarBytes),
  fileFilter: mimeFilter(ALLOWED_AVATAR_MIME),
}).single('avatar');

// Yangın ihbarı — `media[]` (min 1, kontrat 9.1). Çoklu image/video.
// Multer limiti dosya türüne göre ayrışamadığından üst sınır video limitidir;
// görseller için maxDocBytes kontrolü upload sonrası imageSizeGuard'da yapılır.
const fireReportUpload = multer({
  storage: diskStorage('reports'),
  limits: sizeLimit(env.upload.maxVideoBytes),
  fileFilter: mimeFilter(ALLOWED_MEDIA_MIME),
}).array('media', env.upload.maxReportPhotos);

/**
 * Görseller için maxDocBytes sınırını upload sonrası uygular (videolar multer'ın
 * maxVideoBytes sınırına tabidir). Aşım varsa diske yazılmış tüm dosyalar silinir.
 */
function imageSizeGuard(maxBytes) {
  return (req, _res, next) => {
    const files = req.files || (req.file ? [req.file] : []);
    const oversized = files.find((f) => f.mimetype.startsWith('image/') && f.size > maxBytes);
    if (!oversized) return next();
    discardUploads(req);
    return next(
      errors.make(413, 'file_too_large', 'Dosya boyutu sınırı aşıldı', {
        limitBytes: maxBytes,
        field: oversized.originalname,
      }),
    );
  };
}

// K9: ihbar başına toplam dosya sınırı — nginx'in 110 MB gövde sınırının altında kalır ki
// aşım nginx'in HTML 413'ü yerine anlaşılır bir JSON hatayla dönsün.
const FIRE_REPORT_TOTAL_BYTES = 100 * 1024 * 1024;

function totalSizeGuard(maxBytes) {
  return (req, _res, next) => {
    const files = req.files || (req.file ? [req.file] : []);
    const total = files.reduce((sum, f) => sum + (f.size || 0), 0);
    if (total <= maxBytes) return next();
    discardUploads(req);
    return next(
      errors.make(413, 'payload_too_large', 'Dosyaların toplam boyutu sınırı aşıyor', { limitBytes: maxBytes, totalBytes: total }),
    );
  };
}

// Aktif görev fotoğrafı — tek `file` (kontrat 7.5).
const missionPhotoUpload = multer({
  storage: diskStorage('missions'),
  limits: sizeLimit(env.upload.maxDocBytes),
  fileFilter: mimeFilter(ALLOWED_MEDIA_MIME),
}).single('file');

// Operatör olay medyası (panel) — tek `file`; gönüllü fotoğrafıyla aynı biçimler, video için
// video limiti. Görsel sınırı (maxDocBytes) upload sonrası imageSizeGuard'da uygulanır.
const missionMediaUpload = multer({
  storage: diskStorage('missions'),
  limits: sizeLimit(env.upload.maxVideoBytes),
  fileFilter: mimeFilter(ALLOWED_MEDIA_MIME),
}).single('file');

/** Multer hatalarını AppError'a çevirip pipeline'da sürdürür. */
function wrapMulter(handler, limitBytes) {
  return (req, res, next) => {
    handler(req, res, (err) => {
      if (!err || err instanceof AppError) return next(err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          errors.make(413, 'file_too_large', 'Dosya boyutu sınırı aşıldı', { limitBytes }),
        );
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(errors.validation('Beklenmeyen dosya alanı', { field: err.field }));
      }
      // Diğer multer sınırları ve busboy'un bozuk gövde hataları istemci kaynaklıdır; dosya sistemi
      // hataları (syscall taşır) 500 kalır.
      if (err instanceof multer.MulterError || !err.syscall) {
        return next(errors.validation('Dosya yüklemesi geçersiz', { reason: err.code || err.message, field: err.field }));
      }
      return next(err);
    });
  };
}

// Admin içerik medyası (blog kapak/görsel, eğitim video) — tek `file`.
const ALLOWED_CONTENT_MIME = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'];
const contentUpload = multer({
  storage: diskStorage('content'),
  limits: sizeLimit(env.upload.maxDocBytes),
  fileFilter: mimeFilter(ALLOWED_CONTENT_MIME),
}).single('file');

module.exports = {
  onboardingUpload: wrapMulter(onboardingUpload, env.upload.maxDocBytes),
  avatarUpload: wrapMulter(avatarUpload, env.upload.maxAvatarBytes),
  fireReportUpload: [
    wrapMulter(fireReportUpload, env.upload.maxVideoBytes),
    imageSizeGuard(env.upload.maxDocBytes),
    totalSizeGuard(FIRE_REPORT_TOTAL_BYTES),
  ],
  missionPhotoUpload: wrapMulter(missionPhotoUpload, env.upload.maxDocBytes),
  missionMediaUpload: [wrapMulter(missionMediaUpload, env.upload.maxVideoBytes), imageSizeGuard(env.upload.maxDocBytes)],
  contentUpload: wrapMulter(contentUpload, env.upload.maxDocBytes),
  // Test-only: exposes mimeFilter and the allowlist constants for unit tests.
  __testables: { wrapMulter, sizeLimit, mimeFilter, imageSizeGuard, totalSizeGuard, FIRE_REPORT_TOTAL_BYTES, MIME_TO_EXT, ALLOWED_DOC_MIME, ALLOWED_AVATAR_MIME, ALLOWED_MEDIA_MIME },
};
