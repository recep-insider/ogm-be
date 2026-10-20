'use strict';

const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const { verifyPanelAccessToken } = require('../shared/jwt');

const GENERAL_LIMIT = 100;
const ADMIN_LIMIT = 2000;

function isAdminKeyRequest(req) {
  const key = env.admin.apiKey;
  return Boolean(key) && req.headers['x-api-key'] === key;
}

// Yalnız imza kontrolü (DB yok); kullanıcı durumu requireAdmin'de doğrulanır.
function panelSubject(req) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  try {
    return verifyPanelAccessToken(token).sub;
  } catch {
    return null;
  }
}

function adminBucket(req) {
  if (isAdminKeyRequest(req)) return `admin:${req.ip}`;
  const sub = panelSubject(req);
  return sub ? `panel:${sub}` : null;
}

// Panel trafiği aynı ofis/NAT IP'sini mobil kullanıcılarla paylaşabilir; ayrı sayaç tutulur.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: (req) => (adminBucket(req) ? ADMIN_LIMIT : GENERAL_LIMIT),
  keyGenerator: (req) => adminBucket(req) || req.ip,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'İstek limiti aşıldı' } },
});

module.exports = { generalLimiter, GENERAL_LIMIT, ADMIN_LIMIT };
