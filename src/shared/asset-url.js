'use strict';

const env = require('../config/env');

/**
 * Yerel disk'teki göreli dosya yolunu fully-qualified HTTPS URL'e çevirir.
 * `UPLOAD_PUBLIC_BASE_URL` (CDN/R2) tanımlıysa onu, yoksa `API_URL` base'ini kullanır.
 * Zaten http(s) ile başlayan değerler olduğu gibi döner (seed/external URL'ler için).
 * BACKEND_API_CONTRACT.md 0.8 — tüm asset alanları string URL döner.
 */
function assetUrl(rel) {
  if (!rel) return null;
  if (/^https?:\/\//i.test(rel)) return rel;

  const clean = rel.replace(/^\/+/, '');
  const base = (env.upload.publicBaseUrl || env.api.baseUrl).replace(/\/+$/, '');
  return `${base}/${clean}`;
}

module.exports = { assetUrl };
