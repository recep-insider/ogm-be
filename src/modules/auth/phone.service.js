'use strict';

const { v4: uuidv4 } = require('uuid');
const { db } = require('../../config/db');
const { redis } = require('../../config/redis');
const env = require('../../config/env');
const logger = require('../../config/logger');
const { errors } = require('../../shared/errors');
const { generateOtp, hashOtp, verifyOtp } = require('../../shared/otp');
const { sendOtp } = require('../../shared/sms-provider');
const { writeAudit } = require('../../shared/audit');
const {
  signAccessToken,
  signRefreshToken,
  signRegistrationToken,
  accessTokenSeconds,
  registrationTokenSeconds,
} = require('../../shared/jwt');

const PREFIX = 'otp:phone:';
const RATE_PHONE_PREFIX = 'rl:otp:phone:';
const RATE_IP_PREFIX = 'rl:otp:ip:';
const BAN_PREFIX = 'ban:phone:';

function sessionKey(sessionId) {
  return `${PREFIX}${sessionId}`;
}

async function checkRateLimits(phone, ip) {
  const banned = await redis.get(`${BAN_PREFIX}${phone}`);
  if (banned) throw errors.rateLimit('Çok fazla başarısız deneme, lütfen sonra tekrar deneyin');

  const phoneCount = await redis.incr(`${RATE_PHONE_PREFIX}${phone}`);
  if (phoneCount === 1) await redis.expire(`${RATE_PHONE_PREFIX}${phone}`, 3600);
  if (phoneCount > 5) throw errors.rateLimit('Telefon başına saatlik OTP limiti aşıldı');

  if (ip) {
    const ipCount = await redis.incr(`${RATE_IP_PREFIX}${ip}`);
    if (ipCount === 1) await redis.expire(`${RATE_IP_PREFIX}${ip}`, 3600);
    if (ipCount > 50) throw errors.rateLimit('IP başına saatlik OTP limiti aşıldı');
  }
}

async function sendOtpFlow({ phone, ip }) {
  await checkRateLimits(phone, ip);

  const code = generateOtp();
  const codeHash = await hashOtp(code);
  const sessionId = uuidv4();
  const ttl = env.sms.otpExpiresIn;

  const payload = {
    phone,
    codeHash,
    attempts: 0,
    createdAt: Date.now(),
  };
  await redis.set(sessionKey(sessionId), JSON.stringify(payload), 'EX', ttl);

  try {
    await sendOtp(phone, code);
  } catch (err) {
    logger.error('SMS gönderim hatası', { error: err.message, phone });
    throw errors.internal('SMS gönderilemedi');
  }

  return {
    sessionId,
    expiresIn: ttl,
    cooldownSec: env.sms.resendCooldown,
  };
}

async function resendOtpFlow({ sessionId, ip }) {
  const raw = await redis.get(sessionKey(sessionId));
  if (!raw) throw errors.notFound('Oturum bulunamadı veya süresi dolmuş');
  const session = JSON.parse(raw);

  // cooldown kontrolü
  const elapsed = (Date.now() - session.createdAt) / 1000;
  if (elapsed < env.sms.resendCooldown) {
    throw errors.rateLimit(`Lütfen ${Math.ceil(env.sms.resendCooldown - elapsed)} saniye bekleyin`);
  }

  await checkRateLimits(session.phone, ip);

  const code = generateOtp();
  const codeHash = await hashOtp(code);
  session.codeHash = codeHash;
  session.attempts = 0;
  session.createdAt = Date.now();

  const ttl = env.sms.otpExpiresIn;
  await redis.set(sessionKey(sessionId), JSON.stringify(session), 'EX', ttl);

  try {
    await sendOtp(session.phone, code);
  } catch (err) {
    logger.error('SMS gönderim hatası', { error: err.message, phone: session.phone });
    throw errors.internal('SMS gönderilemedi');
  }

  return { cooldownSec: env.sms.resendCooldown, expiresIn: ttl };
}

async function verifyOtpFlow({ sessionId, code, ip, userAgent }) {
  const raw = await redis.get(sessionKey(sessionId));
  if (!raw) throw errors.unauthorized('Doğrulama kodu hatalı');
  const session = JSON.parse(raw);

  session.attempts = (session.attempts || 0) + 1;

  if (session.attempts > env.sms.otpMaxAttempts) {
    await redis.del(sessionKey(sessionId));
    await redis.set(`${BAN_PREFIX}${session.phone}`, '1', 'EX', env.sms.otpLockoutDuration);
    throw errors.rateLimit('Çok fazla başarısız deneme, hesap geçici olarak kilitlendi');
  }

  const ok = await verifyOtp(code, session.codeHash);
  if (!ok) {
    await redis.set(sessionKey(sessionId), JSON.stringify(session), 'KEEPTTL');
    throw errors.unauthorized('Doğrulama kodu hatalı');
  }

  await redis.del(sessionKey(sessionId));

  const existing = await db('users').where({ phone: session.phone, is_active: true }).first();

  if (existing) {
    await writeAudit({
      userId: existing.id,
      action: 'auth.login',
      ip,
      userAgent,
      payload: { method: 'phone' },
    });
    return finalizeExistingUser(existing, ip, userAgent);
  }

  const registrationToken = signRegistrationToken({ sub: null, phone: session.phone });
  return {
    ok: true,
    isExisting: false,
    registrationToken,
    expiresIn: registrationTokenSeconds(),
  };
}

async function finalizeExistingUser(user, ip, userAgent) {
  const accessToken = signAccessToken({ sub: user.id });
  const refreshTokenId = uuidv4();
  const refreshToken = signRefreshToken({ sub: user.id, jti: refreshTokenId });

  const refreshHash = require('crypto')
    .createHash('sha256')
    .update(refreshToken)
    .digest('hex');

  await db('refresh_tokens').insert({
    id: refreshTokenId,
    user_id: user.id,
    token_hash: refreshHash,
    user_agent: userAgent || null,
    ip: ip || null,
    expires_at: new Date(Date.now() + 7 * 86400 * 1000),
  });

  return {
    ok: true,
    isExisting: true,
    accessToken,
    refreshToken,
    expiresIn: accessTokenSeconds(),
    user: {
      id: user.id,
      phone: user.phone,
      profileComplete: !!user.profile_complete,
    },
  };
}

module.exports = { sendOtpFlow, resendOtpFlow, verifyOtpFlow };
