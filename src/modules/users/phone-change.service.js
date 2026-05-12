'use strict';

const { v4: uuidv4 } = require('uuid');
const { redis } = require('../../config/redis');
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
  const sessionId = uuidv4();
  const ttl = env.sms.otpExpiresIn;

  await redis.set(
    `${PREFIX}${sessionId}`,
    JSON.stringify({ userId, newPhone, codeHash, attempts: 0, createdAt: Date.now() }),
    'EX',
    ttl,
  );

  await sendOtp(newPhone, code);
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
  const raw = await redis.get(`${PREFIX}${sessionId}`);
  if (!raw) throw errors.unauthorized('Doğrulama kodu hatalı');
  const session = JSON.parse(raw);
  if (session.userId !== userId) throw errors.forbidden('Oturum sahibi farklı');

  session.attempts = (session.attempts || 0) + 1;
  if (session.attempts > env.sms.otpMaxAttempts) {
    await redis.del(`${PREFIX}${sessionId}`);
    throw errors.rateLimit('Çok fazla başarısız deneme');
  }

  const ok = await verifyOtp(code, session.codeHash);
  if (!ok) {
    await redis.set(`${PREFIX}${sessionId}`, JSON.stringify(session), 'KEEPTTL');
    throw errors.unauthorized('Doğrulama kodu hatalı');
  }

  await redis.del(`${PREFIX}${sessionId}`);

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
