'use strict';

const { v4: uuidv4 } = require('uuid');
const { redis: rawRedis } = require('../../config/redis');
const { guardedClient, delVerifiedSession } = require('../../shared/redis-guard');

const redis = guardedClient(rawRedis);
const { db } = require('../../config/db');
const env = require('../../config/env');
const { errors } = require('../../shared/errors');
const { generateOtp, hashOtp, verifyOtp } = require('../../shared/otp');
const { sendOtp } = require('../../shared/sms-provider');
const { writeAudit } = require('../../shared/audit');

const PREFIX = 'otp:phone-change:';

async function init({ userId, newPhone, ip, userAgent }) {
  // Aynı telefon başka birinde mi kayıtlı?
  const conflict = await db('users')
    .where({ phone: newPhone, is_active: true })
    .whereNot({ id: userId })
    .first();
  if (conflict) {
    throw errors.conflict('Bu telefon başka bir kullanıcıda kayıtlı');
  }

  const code = generateOtp();
  const codeHash = await hashOtp(code);
  // Oturum kod gönderildikten sonra yazılır: limit/sağlayıcı hatası gönderilmemiş koda oturum bırakmaz.
  await sendOtp(newPhone, code, { ip });

  const sessionId = uuidv4();
  const ttl = env.sms.otpExpiresIn;
  await redis.set(
    `${PREFIX}${sessionId}`,
    JSON.stringify({ userId, newPhone, codeHash, attempts: 0, createdAt: Date.now() }),
    'EX',
    ttl,
  );

  await writeAudit({
    userId,
    action: 'users.phone-change.init',
    ip,
    userAgent,
    payload: { newPhone },
  });

  return { sessionId, expiresIn: ttl, cooldownSec: env.sms.resendCooldown };
}

async function commit({ userId, sessionId, code, ip, userAgent }) {
  // Yanlış ya da süresi dolmuş kod oturum hatası (401) değildir; 401 mobilde token yenileyip aynı
  // kodu tekrar göndertiyor ve her yanlış deneme iki hak yiyordu (BUG-038). Girişteki kodlarla aynı.
  const raw = await redis.get(`${PREFIX}${sessionId}`);
  if (!raw) throw errors.gone('Doğrulama kodunun süresi doldu', undefined, 'otp_expired');
  const session = JSON.parse(raw);
  if (session.userId !== userId) throw errors.forbidden('Oturum sahibi farklı');

  session.attempts = (session.attempts || 0) + 1;
  if (session.attempts > env.sms.otpMaxAttempts) {
    await redis.del(`${PREFIX}${sessionId}`);
    // Oturum silinir; kişi yeni kod isteyebilir (yeniden gönderme bekleme süresi kadar sonra).
    throw errors.rateLimit('Çok fazla başarısız deneme; yeni kod isteyin', undefined, { retryAfterSec: env.sms.resendCooldown });
  }

  const ok = await verifyOtp(code, session.codeHash);
  if (!ok) {
    await redis.set(`${PREFIX}${sessionId}`, JSON.stringify(session), 'KEEPTTL');
    throw errors.make(400, 'invalid_otp', 'Geçersiz doğrulama kodu. Lütfen tekrar deneyin.');
  }

  await delVerifiedSession(redis, `${PREFIX}${sessionId}`);

  await db('users').where({ id: userId }).update({
    phone: session.newPhone,
    updated_at: new Date(),
  });

  await writeAudit({
    userId,
    action: 'users.phone-change.commit',
    ip,
    userAgent,
    payload: { newPhone: session.newPhone },
  });

  return { ok: true, phone: session.newPhone };
}

module.exports = { init, commit };
