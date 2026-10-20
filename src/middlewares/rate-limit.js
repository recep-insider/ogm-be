'use strict';

const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const GENERAL_LIMIT = 100;
const ADMIN_LIMIT = 2000;

function isAdminRequest(req) {
  const key = env.admin.apiKey;
  return Boolean(key) && req.headers['x-api-key'] === key;
}

// Panel trafiği aynı ofis/NAT IP'sini mobil kullanıcılarla paylaşabilir; ayrı sayaç tutulur.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: (req) => (isAdminRequest(req) ? ADMIN_LIMIT : GENERAL_LIMIT),
  keyGenerator: (req) => (isAdminRequest(req) ? `admin:${req.ip}` : req.ip),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'İstek limiti aşıldı' } },
});

module.exports = { generalLimiter, GENERAL_LIMIT, ADMIN_LIMIT };
