'use strict';

const crypto = require('crypto');
const path = require('path');
const env = require('../config/env');
const { errors } = require('./errors');

// KVKK özel nitelikli belgeler (sağlık raporu, sabıka kaydı) herkese açık servis edilmez;
// yalnız kısa ömürlü imzalı URL ile (`?exp=&sig=`) erişilir.
const SIGNED_DIRS = ['onboarding'];
const SIGNED_URL_TTL_SEC = 15 * 60;

// Yeni env değişkeni yerine mevcut secret'tan sabit etiketle türetilir.
function signingKey() {
  return crypto.createHmac('sha256', env.jwt.accessSecret).update('ogm:uploads:signed-url:v1').digest();
}

// express.static (send) yolu decode edip `./` önekiyle normalize eder; imza ve kontrol aynı biçimde yapılır.
function normalizeRel(rel) {
  return path.posix.normalize(`./${rel}`);
}

function needsSignature(rel) {
  return SIGNED_DIRS.includes(rel.split('/')[0].toLowerCase());
}

function signature(rel, exp) {
  return crypto.createHmac('sha256', signingKey()).update(`${rel}\n${exp}`).digest('base64url');
}

/**
 * Yerel disk'teki göreli dosya yolunu fully-qualified HTTPS URL'e çevirir.
 * `UPLOAD_PUBLIC_BASE_URL` (CDN/R2) tanımlıysa onu, yoksa `API_URL` base'ini kullanır.
 * Zaten http(s) ile başlayan değerler olduğu gibi döner (seed/external URL'ler için).
 * SIGNED_DIRS altındaki dosyalar SIGNED_URL_TTL_SEC geçerli imzalı URL olarak döner.
 * BACKEND_API_CONTRACT.md 0.8 — tüm asset alanları string URL döner.
 */
function assetUrl(rel) {
  if (!rel) return null;
  if (/^https?:\/\//i.test(rel)) return rel;

  const clean = rel.replace(/^\/+/, '');
  const base = (env.upload.publicBaseUrl || env.api.baseUrl).replace(/\/+$/, '');
  const url = `${base}/${clean}`;
  const normalized = normalizeRel(clean);
  if (!needsSignature(normalized)) return url;

  const exp = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SEC;
  return `${url}?exp=${exp}&sig=${signature(normalized, exp)}`;
}

/** `/uploads` mount'unda express.static'ten önce: imzalı klasörlerde geçerli `exp`+`sig` ister. */
function signedUploadGuard(req, res, next) {
  let rel;
  try {
    rel = normalizeRel(decodeURIComponent(req.path));
  } catch {
    return next(errors.validation('Geçersiz dosya yolu'));
  }
  if (!needsSignature(rel)) return next();

  const exp = Number(req.query.exp);
  const given = Buffer.from(typeof req.query.sig === 'string' ? req.query.sig : '');
  const expected = Buffer.from(signature(rel, exp));
  const valid =
    Number.isInteger(exp) &&
    exp * 1000 >= Date.now() &&
    given.length === expected.length &&
    crypto.timingSafeEqual(given, expected);
  if (!valid) {
    return next(errors.forbidden('Dosya bağlantısı geçersiz veya süresi dolmuş', 'signed_url_invalid'));
  }
  res.set('Cache-Control', 'private, no-store');
  return next();
}

module.exports = { assetUrl, signedUploadGuard, SIGNED_URL_TTL_SEC };
