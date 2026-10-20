'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../../../config/db');
const { redis } = require('../../../config/redis');
const logger = require('../../../config/logger');
const { errors } = require('../../../shared/errors');
const { hitFixedWindow } = require('../../../shared/fixed-window');
const {
  signPanelAccessToken,
  verifyPanelAccessToken,
  panelAccessTokenSeconds,
  PANEL_ROLES,
} = require('../../../shared/jwt');

const BCRYPT_ROUNDS = 12;
const REFRESH_TTL_SEC = 12 * 3600;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_SEC = 15 * 60;
const LOGIN_RL_PREFIX = 'rl:panel-login:';

let dummyHashPromise;
// Kullanıcı yokken de bcrypt karşılaştırması yapılır; yanıt süresi e-postanın varlığını sızdırmasın.
function dummyHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = bcrypt.hash(crypto.randomBytes(16).toString('hex'), BCRYPT_ROUNDS);
  }
  return dummyHashPromise;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function invalidCredentials() {
  return errors.unauthorized('E-posta veya şifre hatalı.', 'invalid_credentials');
}

function statusError(user) {
  if (user.status === 'pending') {
    return errors.forbidden('Hesap talebiniz henüz onaylanmadı.', 'account_pending');
  }
  if (user.status === 'rejected') {
    return errors.make(403, 'account_rejected', 'Hesap talebiniz onaylanmadı.', {
      reason: user.rejection_reason || null,
    });
  }
  return errors.forbidden('Hesabınız devre dışı. Süper admininizle iletişime geçin.', 'account_disabled');
}

function isActive(user) {
  return Boolean(user) && user.status === 'active' && PANEL_ROLES.includes(user.role);
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    mustChangePassword: Boolean(user.must_change_password),
  };
}

function profile(user) {
  return {
    ...publicUser(user),
    bolge: user.bolge_mudurlugu || null,
    isletme: user.isletme_mudurlugu || null,
    phone: user.phone || null,
    lastLoginAt: user.last_login_at || null,
  };
}

async function writePanelAudit({ actorId = null, targetId = null, action, detail = null }) {
  try {
    await db('panel_user_audit').insert({
      actor_id: actorId,
      target_id: targetId,
      action,
      detail: detail ? JSON.stringify(detail) : null,
    });
  } catch (err) {
    logger.warn('Panel audit yazılamadı', { error: err.message, action, targetId });
  }
}

async function issueRefreshToken(userId, meta = {}, id = uuidv4()) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db('panel_refresh_tokens').insert({
    id,
    user_id: userId,
    token_hash: sha256(token),
    expires_at: new Date(Date.now() + REFRESH_TTL_SEC * 1000),
    ip: meta.ip || null,
    user_agent: meta.userAgent ? String(meta.userAgent).slice(0, 255) : null,
  });
  return token;
}

async function revokeAllForUser(userId, { exceptHash } = {}) {
  const query = db('panel_refresh_tokens').where({ user_id: userId }).whereNull('revoked_at');
  if (exceptHash) query.whereNot({ token_hash: exceptHash });
  await query.update({ revoked_at: new Date() });
}

function session(user, refreshToken) {
  return {
    accessToken: signPanelAccessToken({ sub: user.id, role: user.role }),
    expiresIn: panelAccessTokenSeconds(),
    refreshToken,
    user: publicUser(user),
  };
}

// Sayaç bcrypt'ten önce artırılır; başarılı giriş sayacı siler.
function assertLoginAllowed(key) {
  return hitFixedWindow(redis, key, {
    max: LOGIN_MAX_FAILURES,
    windowSec: LOGIN_WINDOW_SEC,
    message: 'Çok fazla deneme yapıldı. Daha sonra tekrar deneyin.',
  });
}

async function login({ email, password }, meta = {}) {
  const normalized = normalizeEmail(email);
  const rlKey = `${LOGIN_RL_PREFIX}${normalized}:${meta.ip || '-'}`;
  await assertLoginAllowed(rlKey);

  const user = await db('panel_users').where({ email: normalized }).first();
  const ok = await bcrypt.compare(String(password), user ? user.password_hash : await dummyHash());
  if (!user || !ok) throw invalidCredentials();
  await redis.del(rlKey);
  if (!isActive(user)) throw statusError(user);

  const refreshToken = await issueRefreshToken(user.id, meta);
  const now = new Date();
  await db('panel_users').where({ id: user.id }).update({ last_login_at: now, updated_at: now });
  await writePanelAudit({ actorId: user.id, targetId: user.id, action: 'auth.login', detail: { ip: meta.ip || null } });
  return session(user, refreshToken);
}

async function refresh(rawToken, meta = {}) {
  if (!rawToken) throw errors.unauthorized('Oturum bulunamadı', 'refresh_invalid');
  const row = await db('panel_refresh_tokens').where({ token_hash: sha256(rawToken) }).first();
  if (!row) throw errors.unauthorized('Oturum bulunamadı', 'refresh_invalid');

  const reused = async () => {
    await revokeAllForUser(row.user_id);
    await writePanelAudit({ targetId: row.user_id, action: 'auth.refresh_reused', detail: { ip: meta.ip || null } });
    return errors.unauthorized('Oturum geçersiz kılındı, tekrar giriş yapın', 'refresh_reused');
  };

  // Yalnız rotasyonla devredilmiş token tekrar kullanımdır; çıkış/şifre değişimiyle kapanan token sadece geçersizdir.
  if (row.revoked_at) {
    if (row.replaced_by) throw await reused();
    throw errors.unauthorized('Oturum bulunamadı', 'refresh_invalid');
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw errors.unauthorized('Oturumun süresi doldu', 'refresh_expired');
  }

  const user = await db('panel_users').where({ id: row.user_id }).first();
  if (!isActive(user)) {
    await revokeAllForUser(row.user_id);
    if (!user) throw errors.unauthorized('Oturum bulunamadı', 'refresh_invalid');
    throw statusError(user);
  }

  const newId = uuidv4();
  // Koşullu güncelleme: aynı token eşzamanlı iki kez sunulursa yalnız biri döner, diğeri tekrar kullanım sayılır.
  const updated = await db('panel_refresh_tokens')
    .where({ id: row.id })
    .whereNull('revoked_at')
    .update({ revoked_at: new Date(), replaced_by: newId });
  if (!updated) {
    const current = await db('panel_refresh_tokens').where({ id: row.id }).first();
    if (current && current.replaced_by) throw await reused();
    throw errors.unauthorized('Oturum bulunamadı', 'refresh_invalid');
  }

  const refreshToken = await issueRefreshToken(user.id, meta, newId);
  return session(user, refreshToken);
}

// Çıkış kişinin tüm oturumlarını kapatır (plan kararı 5): ortak bilgisayarda açık kalan oturum da düşer.
async function logout(rawToken) {
  if (!rawToken) return;
  const row = await db('panel_refresh_tokens').where({ token_hash: sha256(rawToken) }).first();
  if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) return;
  await revokeAllForUser(row.user_id);
  await writePanelAudit({ actorId: row.user_id, targetId: row.user_id, action: 'auth.logout' });
}

async function changePassword(user, { currentPassword, newPassword }, currentRefreshToken) {
  const ok = await bcrypt.compare(String(currentPassword), user.password_hash);
  if (!ok) throw invalidCredentials();

  const now = new Date();
  await db('panel_users').where({ id: user.id }).update({
    password_hash: await hashPassword(newPassword),
    must_change_password: false,
    updated_at: now,
  });
  await revokeAllForUser(user.id, {
    exceptHash: currentRefreshToken ? sha256(currentRefreshToken) : undefined,
  });
  await writePanelAudit({ actorId: user.id, targetId: user.id, action: 'auth.password_change' });
}

async function findActiveUserByToken(token) {
  let payload;
  try {
    payload = verifyPanelAccessToken(token);
  } catch {
    return null;
  }
  const user = await db('panel_users').where({ id: payload.sub }).first();
  return isActive(user) ? user : null;
}

module.exports = {
  login,
  refresh,
  logout,
  changePassword,
  findActiveUserByToken,
  profile,
  hashPassword,
  normalizeEmail,
  revokeAllForUser,
  writePanelAudit,
  REFRESH_TTL_SEC,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_SEC,
};
