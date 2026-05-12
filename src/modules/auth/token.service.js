'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../../config/db');
const { redis } = require('../../config/redis');
const { errors } = require('../../shared/errors');
const { writeAudit } = require('../../shared/audit');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  accessTokenSeconds,
} = require('../../shared/jwt');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function refresh({ refreshToken, ip, userAgent }) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw errors.unauthorized('Geçersiz refresh token');
  }

  const blacklisted = await redis.get(`bl:refresh:${payload.jti}`);
  if (blacklisted) throw errors.unauthorized('Refresh token iptal edilmiş');

  const tokenHash = hashToken(refreshToken);
  const stored = await db('refresh_tokens')
    .where({ id: payload.jti })
    .whereNull('revoked_at')
    .first();

  if (!stored || stored.token_hash !== tokenHash) {
    throw errors.unauthorized('Refresh token bulunamadı');
  }
  if (new Date(stored.expires_at).getTime() < Date.now()) {
    throw errors.unauthorized('Refresh token süresi dolmuş');
  }

  // Rotation: eski'yi revoke et, yeni'yi yaz
  const newId = uuidv4();
  const newRefresh = signRefreshToken({ sub: payload.sub, jti: newId });
  const newAccess = signAccessToken({ sub: payload.sub });

  await db.transaction(async (trx) => {
    await trx('refresh_tokens').where({ id: stored.id }).update({
      revoked_at: trx.fn.now(),
      replaced_by: newId,
    });
    await trx('refresh_tokens').insert({
      id: newId,
      user_id: payload.sub,
      token_hash: hashToken(newRefresh),
      user_agent: userAgent || null,
      ip: ip || null,
      expires_at: new Date(Date.now() + 7 * 86400 * 1000),
    });
  });

  await writeAudit({
    userId: payload.sub,
    action: 'auth.refresh',
    ip,
    userAgent,
    payload: { rotatedFrom: stored.id, rotatedTo: newId },
  });

  return {
    accessToken: newAccess,
    refreshToken: newRefresh,
    expiresIn: accessTokenSeconds(),
  };
}

async function logout({ refreshToken, ip, userAgent }) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    return; // sessizce başarılı say
  }

  await db('refresh_tokens')
    .where({ id: payload.jti })
    .whereNull('revoked_at')
    .update({ revoked_at: db.fn.now() });

  // 7 gün TTL ile blacklist'e koy
  await redis.set(`bl:refresh:${payload.jti}`, '1', 'EX', 7 * 86400);

  await writeAudit({
    userId: payload.sub,
    action: 'auth.logout',
    ip,
    userAgent,
    payload: { jti: payload.jti },
  });
}

module.exports = { refresh, logout };
