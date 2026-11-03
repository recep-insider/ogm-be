'use strict';

const { v4: uuidv4 } = require('uuid');
const { db } = require('../../config/db');
const { redis: rawRedis } = require('../../config/redis');
const { guardedClient, delVerifiedSession } = require('../../shared/redis-guard');

const redis = guardedClient(rawRedis);
const env = require('../../config/env');
const logger = require('../../config/logger');
const { AppError, errors } = require('../../shared/errors');
const { hitFixedWindow } = require('../../shared/fixed-window');
const { generateOtp, hashOtp, verifyOtp } = require('../../shared/otp');
const { sendOtp, assertOtpDeliverable, maskPhone } = require('../../shared/sms-provider');
const { writeAudit } = require('../../shared/audit');
const { toDateOnly } = require('../../shared/dates');
const { getApplicationStatus } = require('../users/users.service');
const { restorableSince } = require('../users/anonymize.service');
const {
  signAccessToken,
  signRefreshToken,
  signRegistrationToken,
  signRestoreToken,
  verifyRestoreToken,
  accessTokenSeconds,
  registrationTokenSeconds,
  restoreTokenSeconds,
  userBlockKey,
} = require('../../shared/jwt');

const PREFIX = 'otp:phone:';
const RATE_PHONE_PREFIX = 'rl:otp:phone:';
const RATE_IP_PREFIX = 'rl:otp:ip:';
const BAN_PREFIX = 'ban:phone:';

function sessionKey(sessionId) {
  return `${PREFIX}${sessionId}`;
}

function isDummyPhone(phone) {
  return env.sms.dummyPhones.includes(phone);
}

function getOtpForPhone(phone) {
  if (isDummyPhone(phone)) return env.sms.dummyCode;
  return generateOtp();
}

async function checkRateLimits(phone, ip) {
  const banned = await redis.get(`${BAN_PREFIX}${phone}`);
  if (banned) {
    const ttl = await redis.ttl(`${BAN_PREFIX}${phone}`);
    throw errors.rateLimit('Çok fazla başarısız deneme, lütfen sonra tekrar deneyin', undefined, {
      retryAfterSec: ttl > 0 ? ttl : env.sms.otpLockoutDuration,
    });
  }

  await hitFixedWindow(rawRedis, `${RATE_PHONE_PREFIX}${phone}`, {
    max: 5,
    windowSec: 3600,
    message: 'Telefon başına saatlik OTP limiti aşıldı',
  });

  if (ip) {
    await hitFixedWindow(rawRedis, `${RATE_IP_PREFIX}${ip}`, {
      max: 50,
      windowSec: 3600,
      message: 'IP başına saatlik OTP limiti aşıldı',
    });
  }
}

async function sendOtpFlow({ phone, ip }) {
  assertOtpDeliverable(phone);
  await checkRateLimits(phone, ip);

  const code = getOtpForPhone(phone);
  const codeHash = await hashOtp(code);

  // Oturum kod gönderildikten sonra yazılır: limit/sağlayıcı hatası gönderilmemiş koda oturum bırakmaz.
  try {
    await sendOtp(phone, code, { ip });
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error('SMS gönderim hatası', { error: err.message, phone: maskPhone(phone) });
    throw errors.internal('SMS gönderilemedi');
  }

  const sessionId = uuidv4();
  const ttl = env.sms.otpExpiresIn;
  const payload = {
    phone,
    codeHash,
    attempts: 0,
    createdAt: Date.now(),
  };
  await redis.set(sessionKey(sessionId), JSON.stringify(payload), 'EX', ttl);

  return {
    sessionId,
    expiresIn: ttl,
    cooldownSec: env.sms.resendCooldown,
  };
}

async function resendOtpFlow({ sessionId, ip }) {
  const raw = await redis.get(sessionKey(sessionId));
  if (!raw) throw errors.notFound('Oturum bulunamadı veya süresi dolmuş', 'session_not_found');
  const session = JSON.parse(raw);

  // cooldown kontrolü
  const elapsed = (Date.now() - session.createdAt) / 1000;
  if (elapsed < env.sms.resendCooldown) {
    const retryAfterSec = Math.ceil(env.sms.resendCooldown - elapsed);
    throw errors.rateLimit(`Lütfen ${retryAfterSec} saniye bekleyin`, undefined, { retryAfterSec });
  }

  assertOtpDeliverable(session.phone);
  await checkRateLimits(session.phone, ip);

  const code = getOtpForPhone(session.phone);
  const codeHash = await hashOtp(code);

  // Yeni kod gönderilemezse oturum değişmez; telefondaki önceki kod geçerli kalır.
  try {
    await sendOtp(session.phone, code, { ip });
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error('SMS gönderim hatası', { error: err.message, phone: maskPhone(session.phone) });
    throw errors.internal('SMS gönderilemedi');
  }

  session.codeHash = codeHash;
  session.attempts = 0;
  session.createdAt = Date.now();
  const ttl = env.sms.otpExpiresIn;
  await redis.set(sessionKey(sessionId), JSON.stringify(session), 'EX', ttl);

  return { cooldownSec: env.sms.resendCooldown, expiresIn: ttl };
}

async function verifyOtpFlow({ sessionId, code, ip, userAgent }) {
  const raw = await redis.get(sessionKey(sessionId));
  if (!raw) throw errors.gone('Doğrulama kodunun süresi doldu', undefined, 'otp_expired');
  const session = JSON.parse(raw);

  session.attempts = (session.attempts || 0) + 1;

  if (session.attempts > env.sms.otpMaxAttempts) {
    await redis.del(sessionKey(sessionId));
    await redis.set(`${BAN_PREFIX}${session.phone}`, '1', 'EX', env.sms.otpLockoutDuration);
    throw errors.rateLimit('Çok fazla başarısız deneme, hesap geçici olarak kilitlendi', undefined, {
      retryAfterSec: env.sms.otpLockoutDuration,
    });
  }

  const ok = await verifyOtp(code, session.codeHash);
  if (!ok) {
    await redis.set(sessionKey(sessionId), JSON.stringify(session), 'KEEPTTL');
    throw errors.make(400, 'invalid_otp', 'Geçersiz doğrulama kodu. Lütfen tekrar deneyin.');
  }

  await delVerifiedSession(redis, sessionKey(sessionId));

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

  // Silinme sürecindeki hesap (K28): kişiye önce sorulur; "Devam" derse /auth/restore silmeyi iptal eder.
  const pending = await db('users')
    .where({ phone: session.phone })
    .whereNotNull('deleted_at')
    .where('deleted_at', '>', restorableSince())
    .whereNull('anonymized_at')
    .first();
  if (pending) {
    return {
      ok: true,
      isExisting: true,
      pendingDeletion: true,
      restoreToken: signRestoreToken({ sub: pending.id }),
      expiresIn: restoreTokenSeconds(),
    };
  }

  const registrationToken = signRegistrationToken({ sub: null, phone: session.phone });
  return {
    ok: true,
    isExisting: false,
    registrationToken,
    expiresIn: registrationTokenSeconds(),
  };
}

/**
 * Silme talebini iptal eder (K28): hesap yeniden açılır, erişim engeli kalkar, oturum verilir.
 * Token, yalnız kendisi verilmeden önce silinmiş hesabı açar; kullanıldıktan sonra ya da hesap
 * yeniden silinmişse işe yaramaz.
 */
async function restoreFlow({ restoreToken, ip, userAgent }) {
  let payload;
  try {
    payload = verifyRestoreToken(restoreToken);
  } catch {
    throw errors.unauthorized('Silme talebi iptal edilemedi; lütfen tekrar giriş yapın.', 'restore_invalid');
  }
  const issuedAt = new Date(payload.iat * 1000);
  const pending = () => db('users')
    .where({ id: payload.sub })
    .whereNotNull('deleted_at')
    .whereNull('anonymized_at')
    .where('deleted_at', '<=', issuedAt)
    .where('deleted_at', '>', restorableSince());

  if (!(await pending().first())) {
    throw errors.unauthorized('Silme talebi iptal edilemedi; lütfen tekrar giriş yapın.', 'restore_invalid');
  }

  // Hesap açılamazsa (arada anonimleşti, DB hatası) kaldırılan erişim engeli geri yazılır:
  // silinmiş hesabın eski access token'ları yeniden işe yaramasın.
  const reblock = async () => {
    try {
      await redis.set(userBlockKey(payload.sub), '1', 'EX', accessTokenSeconds());
    } catch (err) {
      logger.warn('Silinen hesabın erişim engeli geri yazılamadı', { userId: payload.sub, error: err.message });
    }
  };

  try {
    await redis.del(userBlockKey(payload.sub));
  } catch (err) {
    logger.warn('Silinen hesabın erişim engeli kaldırılamadı', { userId: payload.sub, error: err.message });
    // Yanıtı geciken silme Redis'te sonradan uygulanabilir; hesap açılmadığı için engel geri yazılır.
    if (err.maybeApplied) await reblock();
    throw errors.make(503, 'restore_unavailable', 'Hesap şu an açılamıyor; birkaç saniye sonra tekrar deneyin.');
  }

  const now = new Date();
  let restored;
  try {
    restored = await pending().update({ is_active: true, deleted_at: null, updated_at: now });
  } catch (err) {
    await reblock();
    throw err;
  }
  if (!restored) {
    // Eşzamanlı ikinci istek: hesabı öteki açtıysa engel geri yazılmaz, açılan hesap kilitlenmesin.
    const after = await db('users').where({ id: payload.sub }).first('deleted_at');
    if (after?.deleted_at) await reblock();
    throw errors.unauthorized('Silme talebi iptal edilemedi; lütfen tekrar giriş yapın.', 'restore_invalid');
  }

  const user = await db('users').where({ id: payload.sub }).first();
  await writeAudit({
    userId: user.id,
    action: 'users.restore',
    entity: 'user',
    entityId: user.id,
    ip,
    userAgent,
    payload: { method: 'phone' },
  });
  return finalizeExistingUser(user, ip, userAgent);
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

  const applicationStatus = await getApplicationStatus(user.id);

  return {
    ok: true,
    isExisting: true,
    accessToken,
    refreshToken,
    expiresIn: accessTokenSeconds(),
    user: {
      id: user.id,
      tcKimlik: user.tc_kimlik,
      ad: user.ad,
      soyad: user.soyad,
      dogumTarihi: toDateOnly(user.dogum_tarihi),
      phone: user.phone,
      eposta: user.eposta,
      profileComplete: !!user.profile_complete,
      applicationStatus,
    },
  };
}

module.exports = { sendOtpFlow, resendOtpFlow, verifyOtpFlow, restoreFlow, isDummyPhone, getOtpForPhone };
