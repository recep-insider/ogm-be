'use strict';

const rateLimit = require('express-rate-limit');
const { verifyPanelAccessToken } = require('../shared/jwt');

const GENERAL_LIMIT = 100;
const ADMIN_LIMIT = 2000;

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
  const sub = panelSubject(req);
  return sub ? `panel:${sub}` : null;
}

// Tüm 429 yanıtları istemciye ne kadar bekleyeceğini söyler (BUG-028, MOBIL_TALEPLERI §1).
function rateLimitHandler(message) {
  return (req, res) => {
    const resetAt = req.rateLimit?.resetTime ? new Date(req.rateLimit.resetTime).getTime() : null;
    const retryAfterSec = resetAt ? Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)) : 60;
    res.status(429).json({ error: { code: 'rate_limited', message, details: { retryAfterSec } } });
  };
}

// Panel trafiği aynı ofis/NAT IP'sini mobil kullanıcılarla paylaşabilir; ayrı sayaç tutulur.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: (req) => (adminBucket(req) ? ADMIN_LIMIT : GENERAL_LIMIT),
  keyGenerator: (req) => adminBucket(req) || req.ip,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler('İstek limiti aşıldı'),
});

module.exports = { generalLimiter, rateLimitHandler, GENERAL_LIMIT, ADMIN_LIMIT };
