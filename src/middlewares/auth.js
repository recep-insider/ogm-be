'use strict';

const { errors } = require('../shared/errors');
const { verifyAccessToken, verifyRegistrationToken } = require('../shared/jwt');
const { redis } = require('../config/redis');
const env = require('../config/env');

function extractBearer(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

/**
 * Erişim token'ı zorunlu — geçersiz/eksikse 401.
 */
function requireAuth(req, _res, next) {
  const token = extractBearer(req);
  if (!token) return next(errors.unauthorized('Token gerekli'));

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, ...payload };
    req.token = token;
    return next();
  } catch (err) {
    return next(errors.unauthorized('Geçersiz veya süresi dolmuş token'));
  }
}

/**
 * Erişim token'ı varsa kullanıcıyı set eder; yoksa devam eder (guest mode).
 */
function optionalAuth(req, _res, next) {
  const token = extractBearer(req);
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, ...payload };
    req.token = token;
  } catch {
    // sessizce yoksay
  }
  return next();
}

/**
 * Sadece kayıt formu submit'i için verilmiş kısa süreli registration token.
 */
function requireRegistrationToken(req, _res, next) {
  const token = extractBearer(req);
  if (!token) return next(errors.unauthorized('Registration token gerekli'));

  try {
    const payload = verifyRegistrationToken(token);
    req.registration = payload;
    return next();
  } catch (err) {
    return next(errors.unauthorized('Geçersiz registration token'));
  }
}

/**
 * Ya tam access token ya da registration token kabul eder.
 * `/onboarding/complete` gibi her iki durumun gerekli olduğu uçlar için.
 */
function requireAuthOrRegistration(req, _res, next) {
  const token = extractBearer(req);
  if (!token) return next(errors.unauthorized('Token gerekli'));

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, ...payload };
    req.token = token;
    return next();
  } catch {
    try {
      const payload = verifyRegistrationToken(token);
      req.registration = payload;
      req.token = token;
      return next();
    } catch {
      return next(errors.unauthorized('Geçersiz token'));
    }
  }
}

/**
 * Refresh token'ın blacklist'te olup olmadığını kontrol eder.
 * `/auth/refresh` ve logout sonrası kullanılır.
 */
async function isRefreshBlacklisted(jti) {
  if (!jti) return false;
  try {
    const v = await redis.get(`bl:refresh:${jti}`);
    return v !== null;
  } catch {
    return false;
  }
}

/**
 * API anahtarı ya da access token'daki `role` claim'i ile yetki kontrolü.
 * Saha amiri (officer) / admin uçları mobil uygulamadan değil ayrı panel/cihazdan çağrılır.
 */
function apiKeyOrRole(roleNames, getKeys) {
  return (req, _res, next) => {
    const provided = req.headers['x-api-key'];
    const validKeys = getKeys().filter(Boolean);
    if (provided && validKeys.includes(provided)) {
      req.actor = { type: 'api_key', role: roleNames[0] };
      return next();
    }
    const token = extractBearer(req);
    if (token) {
      try {
        const payload = verifyAccessToken(token);
        if (roleNames.includes(payload.role)) {
          req.user = { id: payload.sub, ...payload };
          req.actor = { type: 'token', role: payload.role };
          return next();
        }
      } catch {
        // düş — yetki yok
      }
    }
    return next(errors.forbidden('Bu işlem için yetkiniz yok'));
  };
}

const requireAdmin = apiKeyOrRole(['admin'], () => [env.admin.apiKey]);
const requireOfficer = apiKeyOrRole(
  ['officer', 'admin'],
  () => [env.admin.officerApiKey, env.admin.apiKey],
);

module.exports = {
  requireAuth,
  optionalAuth,
  requireRegistrationToken,
  requireAuthOrRegistration,
  requireAdmin,
  requireOfficer,
  isRefreshBlacklisted,
};
