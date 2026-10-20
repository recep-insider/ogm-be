'use strict';

const { errors } = require('../shared/errors');
const { verifyAccessToken, verifyRegistrationToken } = require('../shared/jwt');
const { redis } = require('../config/redis');
const env = require('../config/env');
const panelAuthService = require('../modules/admin/auth/panelAuth.service');

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

async function authenticatePanel(req, token) {
  const user = await panelAuthService.findActiveUserByToken(token);
  if (!user) throw errors.unauthorized('Geçersiz veya süresi dolmuş token');
  req.panelUser = user;
  req.user = { id: user.id, role: user.role };
  req.actor = { type: 'panel_user', role: user.role, userId: user.id, name: user.name };
}

/**
 * Panel access token'ı zorunlu; şifre değiştirme zorunluluğu olan kullanıcıyı da kabul eder.
 * Yalnız `/admin/auth/me` ve `/admin/auth/password` için.
 */
function requirePanelUser(req, _res, next) {
  const token = extractBearer(req);
  if (!token) return next(errors.unauthorized('Token gerekli'));
  return authenticatePanel(req, token).then(() => next(), next);
}

/**
 * API anahtarı ya da panel access token'ı ile yetki kontrolü. Mobil access token'ı kabul edilmez.
 * Panel kullanıcısının durumu her istekte veritabanından okunur (pasifleştirme anında etkili olur).
 */
function apiKeyOrPanelUser(apiKeyRole, getKeys) {
  return (req, _res, next) => {
    const provided = req.headers['x-api-key'];
    const validKeys = getKeys().filter(Boolean);
    if (provided && validKeys.includes(provided)) {
      req.actor = { type: 'api_key', role: apiKeyRole };
      return next();
    }
    const token = extractBearer(req);
    if (!token) return next(errors.forbidden('Bu işlem için yetkiniz yok'));
    return authenticatePanel(req, token).then(() => {
      if (req.panelUser.must_change_password) {
        return next(errors.forbidden('Devam etmek için şifrenizi değiştirin.', 'password_change_required'));
      }
      return next();
    }, next);
  };
}

const requireAdmin = apiKeyOrPanelUser('admin', () => [env.admin.apiKey]);
const requireOfficer = apiKeyOrPanelUser(
  'officer',
  () => [env.admin.officerApiKey, env.admin.apiKey],
);

module.exports = {
  requireAuth,
  optionalAuth,
  requireRegistrationToken,
  requireAuthOrRegistration,
  requireAdmin,
  requireOfficer,
  requirePanelUser,
  isRefreshBlacklisted,
};
