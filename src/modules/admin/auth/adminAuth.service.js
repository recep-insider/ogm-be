'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const { db } = require('../../../config/db');
const { redis } = require('../../../config/redis');
const env = require('../../../config/env');
const { errors } = require('../../../shared/errors');
const { writeAudit } = require('../../../shared/audit');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  accessTokenSeconds,
} = require('../../../shared/jwt');

const REFRESH_TTL_SEC = 7 * 86400;
const REFRESH_TTL_MS = REFRESH_TTL_SEC * 1000;
// IP-based login lockout — an email-based counter would let an attacker lock a
// known admin account out by sending wrong passwords for it (account-lockout
// DoS). Keying by IP only throttles the malicious source, not the victim.
const LOGIN_FAIL_PREFIX = 'rl:admin:login:ip:';
const BLACKLIST_PREFIX = 'bl:admin_refresh:';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function publicAdmin(admin) {
  return {
    id: admin.id,
    eposta: admin.eposta,
    ad: admin.ad,
    soyad: admin.soyad,
    role: admin.role,
  };
}

/**
 * Signs a fresh access+refresh pair and persists the refresh token. Accepts an
 * optional `trx` so the refresh rotation can insert inside its transaction.
 * Returns the token pair plus the new `refreshId` (for the rotation link).
 */
async function issueTokens(admin, { ip, userAgent, trx } = {}) {
  const runner = trx || db;
  const accessToken = signAccessToken({ sub: admin.id, role: admin.role, atyp: 'admin' });
  const refreshId = uuidv4();
  const refreshToken = signRefreshToken({ sub: admin.id, jti: refreshId });

  await runner('admin_refresh_tokens').insert({
    id: refreshId,
    admin_user_id: admin.id,
    token_hash: hashToken(refreshToken),
    user_agent: userAgent || null,
    ip: ip || null,
    expires_at: new Date(Date.now() + REFRESH_TTL_MS),
  });

  return { accessToken, refreshToken, expiresIn: accessTokenSeconds(), refreshId };
}

/**
 * Admin/officer login with email + password. To avoid user enumeration, the
 * "not found", "wrong password" and "inactive account" cases all return the
 * same generic 401, and failed attempts are counted per IP (lockout).
 */
async function login({ eposta, sifre, ip, userAgent }) {
  const normalized = String(eposta).toLowerCase();
  // Lockout is IP-based; without an IP (theoretical) the counter cannot apply — skip it.
  const failKey = ip ? `${LOGIN_FAIL_PREFIX}${ip}` : null;

  if (failKey) {
    const fails = Number(await redis.get(failKey)) || 0;
    if (fails >= env.admin.loginMaxAttempts) {
      throw errors.rateLimit('Çok fazla başarısız deneme, lütfen sonra tekrar deneyin');
    }
  }

  const admin = await db('admin_users')
    .whereRaw('LOWER(eposta) = ?', [normalized])
    .whereNull('deleted_at')
    .first();

  const passwordOk = admin ? await bcrypt.compare(sifre, admin.password_hash) : false;

  if (!admin || !passwordOk || !admin.is_active) {
    if (failKey) {
      const next = await redis.incr(failKey);
      if (next === 1) await redis.expire(failKey, env.admin.loginLockoutDuration);
    }
    throw errors.unauthorized('E-posta veya şifre hatalı', 'invalid_credentials');
  }

  if (failKey) await redis.del(failKey);

  // Token issue, last-login stamp and audit are independent → run concurrently.
  const [issued] = await Promise.all([
    issueTokens(admin, { ip, userAgent }),
    db('admin_users').where({ id: admin.id }).update({ last_login_at: db.fn.now() }),
    writeAudit({
      userId: admin.id,
      action: 'admin.auth.login',
      ip,
      userAgent,
      payload: { role: admin.role },
    }),
  ]);

  const { refreshId, ...tokens } = issued;
  return { ...tokens, admin: publicAdmin(admin) };
}

/**
 * Refresh token rotation: revokes the old token and issues a new access+refresh
 * pair. Validates against the separate `admin_refresh_tokens` table.
 */
async function refresh({ refreshToken, ip, userAgent }) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw errors.unauthorized('Geçersiz refresh token');
  }

  const blacklisted = await redis.get(`${BLACKLIST_PREFIX}${payload.jti}`);
  if (blacklisted) throw errors.unauthorized('Refresh token iptal edilmiş');

  // Two independent lookups (after the cheap blacklist short-circuit).
  const [stored, admin] = await Promise.all([
    db('admin_refresh_tokens').where({ id: payload.jti }).whereNull('revoked_at').first(),
    db('admin_users').where({ id: payload.sub }).whereNull('deleted_at').first(),
  ]);

  if (!stored || stored.token_hash !== hashToken(refreshToken)) {
    throw errors.unauthorized('Refresh token bulunamadı');
  }
  if (new Date(stored.expires_at).getTime() < Date.now()) {
    throw errors.unauthorized('Refresh token süresi dolmuş');
  }
  if (!admin || !admin.is_active) {
    throw errors.unauthorized('Hesap artık aktif değil');
  }

  let issued;
  await db.transaction(async (trx) => {
    issued = await issueTokens(admin, { ip, userAgent, trx });
    await trx('admin_refresh_tokens').where({ id: stored.id }).update({
      revoked_at: trx.fn.now(),
      replaced_by: issued.refreshId,
    });
  });

  await writeAudit({
    userId: admin.id,
    action: 'admin.auth.refresh',
    ip,
    userAgent,
    payload: { rotatedFrom: stored.id, rotatedTo: issued.refreshId },
  });

  const { refreshId, ...tokens } = issued;
  return tokens;
}

/**
 * Revokes the refresh token and adds it to the blacklist. On an invalid token
 * it succeeds silently (logout is always idempotent).
 */
async function logout({ refreshToken, ip, userAgent }) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    return;
  }

  // Revoke, blacklist and audit are independent → run concurrently.
  await Promise.all([
    db('admin_refresh_tokens')
      .where({ id: payload.jti })
      .whereNull('revoked_at')
      .update({ revoked_at: db.fn.now() }),
    redis.set(`${BLACKLIST_PREFIX}${payload.jti}`, '1', 'EX', REFRESH_TTL_SEC),
    writeAudit({
      userId: payload.sub,
      action: 'admin.auth.logout',
      ip,
      userAgent,
      payload: { jti: payload.jti },
    }),
  ]);
}

/** Profile of the current admin (`/admin/auth/me`). */
async function me(adminId) {
  const admin = await db('admin_users')
    .where({ id: adminId })
    .whereNull('deleted_at')
    .first();
  if (!admin || !admin.is_active) throw errors.unauthorized('Oturum geçersiz');
  return publicAdmin(admin);
}

module.exports = { login, refresh, logout, me, publicAdmin, hashToken };
