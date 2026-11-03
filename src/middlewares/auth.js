'use strict';

const { errors } = require('../shared/errors');
const { verifyAccessToken, verifyRegistrationToken, userBlockKey } = require('../shared/jwt');
const { redis } = require('../config/redis');
const env = require('../config/env');
const panelAuthService = require('../modules/admin/auth/panelAuth.service');

function extractBearer(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

// Takılan bir Redis bağlantısında GET hiç sonuçlanmayabilir; kontrol en fazla bu kadar bekler.
const BLOCK_CHECK_TIMEOUT_MS = 200;

/**
 * Hesabı silinen gönüllünün henüz süresi dolmamış access token'ları (users.service softDelete yazar).
 * Redis hazır değilse, hata verirse ya da zamanında yanıt vermezse engel yok sayılır: gönüllünün SOS ve
 * ihbar istekleri kesintide de beklemeden işlenmeli.
 */
async function isUserBlocked(userId) {
  if (redis.status !== 'ready') return false;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), BLOCK_CHECK_TIMEOUT_MS);
  });
  try {
    return (await Promise.race([redis.get(userBlockKey(userId)), timeout])) !== null;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function verifyActiveAccessToken(token) {
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return Promise.resolve(null);
  }
  return isUserBlocked(payload.sub).then((blocked) => (blocked ? null : payload));
}

/**
 * Erişim token'ı zorunlu — geçersiz/eksikse 401.
 */
function requireAuth(req, _res, next) {
  const token = extractBearer(req);
  if (!token) return next(errors.unauthorized('Token gerekli'));

  return verifyActiveAccessToken(token).then((payload) => {
    if (!payload) return next(errors.unauthorized('Geçersiz veya süresi dolmuş token'));
    req.user = { id: payload.sub, ...payload };
    req.token = token;
    return next();
  });
}

/**
 * Erişim token'ı varsa kullanıcıyı set eder; yoksa devam eder (guest mode).
 */
function optionalAuth(req, _res, next) {
  const token = extractBearer(req);
  if (!token) return next();
  return verifyActiveAccessToken(token).then((payload) => {
    if (payload) {
      req.user = { id: payload.sub, ...payload };
      req.token = token;
    }
    return next();
  });
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
    req.registration = verifyRegistrationToken(token);
    req.token = token;
    return next();
  } catch {
    // kayıt token'ı değil; access token olarak denenir
  }
  return verifyActiveAccessToken(token).then((payload) => {
    if (!payload) return next(errors.unauthorized('Geçersiz token'));
    req.user = { id: payload.sub, ...payload };
    req.token = token;
    return next();
  });
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

function authenticatePanelAdmin(req, next) {
  const token = extractBearer(req);
  if (!token) return next(errors.forbidden('Bu işlem için yetkiniz yok'));
  return authenticatePanel(req, token).then(() => {
    if (req.panelUser.must_change_password) {
      return next(errors.forbidden('Devam etmek için şifrenizi değiştirin.', 'password_change_required'));
    }
    return next();
  }, next);
}

/**
 * Panel access token'ı ile yetki kontrolü. Mobil access token'ı kabul edilmez.
 * Panel kullanıcısının durumu ve rolü her istekte veritabanından okunur (pasifleştirme anında etkili olur).
 */
function requireAdmin(req, _res, next) {
  return authenticatePanelAdmin(req, next);
}

function requireSuperAdmin(req, res, next) {
  return requireAdmin(req, res, (err) => {
    if (err) return next(err);
    if (req.panelUser.role !== 'super_admin') {
      return next(errors.forbidden('Bu işlem için süper admin yetkisi gerekir.', 'super_admin_required'));
    }
    return next();
  });
}

/** Saha amiri cihazı OFFICER_API_KEY ile, panel kullanıcısı access token'ıyla gelir. */
function requireOfficer(req, _res, next) {
  const key = env.admin.officerApiKey;
  if (key && req.headers['x-api-key'] === key) {
    req.actor = { type: 'api_key', role: 'officer' };
    return next();
  }
  return authenticatePanelAdmin(req, next);
}

module.exports = {
  requireAuth,
  optionalAuth,
  requireRegistrationToken,
  requireAuthOrRegistration,
  requireAdmin,
  requireSuperAdmin,
  requireOfficer,
  requirePanelUser,
  isRefreshBlacklisted,
};
