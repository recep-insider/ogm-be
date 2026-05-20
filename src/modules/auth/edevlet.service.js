'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { db } = require('../../config/db');
const { redis } = require('../../config/redis');
const env = require('../../config/env');
const logger = require('../../config/logger');
const { errors } = require('../../shared/errors');
const { writeAudit } = require('../../shared/audit');
const { toDateOnly } = require('../../shared/dates');
const {
  signAccessToken,
  signRefreshToken,
  signRegistrationToken,
  accessTokenSeconds,
  registrationTokenSeconds,
} = require('../../shared/jwt');

const SESSION_PREFIX = 'edevlet:session:';

function sessionKey(id) {
  return `${SESSION_PREFIX}${id}`;
}

async function initiate({ callbackScheme }) {
  if (!env.edevlet.enabled) {
    throw errors.make(503, 'edevlet_unavailable', 'e-Devlet girişi şu anda kullanılamıyor');
  }
  const sessionId = uuidv4();
  const state = crypto.randomBytes(16).toString('hex');
  const ttl = env.edevlet.sessionTtl;

  await redis.set(
    sessionKey(sessionId),
    JSON.stringify({ state, callbackScheme, createdAt: Date.now() }),
    'EX',
    ttl,
  );

  let redirectUrl;
  if (env.edevlet.mockMode) {
    redirectUrl = `${env.api.baseUrl}/v1/auth/edevlet/mock?sessionId=${sessionId}&state=${state}`;
  } else {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: env.edevlet.clientId,
      redirect_uri: env.edevlet.callbackUrl,
      scope: 'kimlik',
      state: `${sessionId}:${state}`,
    });
    redirectUrl = `${env.edevlet.authorizeUrl}?${params.toString()}`;
  }

  return { sessionId, redirectUrl, expiresIn: ttl };
}

async function fetchUserInfoFromEdevlet(code) {
  const tokenRes = await axios.post(
    env.edevlet.tokenUrl,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.edevlet.callbackUrl,
      client_id: env.edevlet.clientId,
      client_secret: env.edevlet.clientSecret,
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10_000 },
  );
  const accessToken = tokenRes.data.access_token;
  const userInfo = await axios.get(env.edevlet.userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 10_000,
  });
  return userInfo.data;
}

function buildMockKimlik() {
  return {
    tcKimlik: '10000000146',
    ad: 'Özge',
    soyad: 'Özdiller',
    dogumTarihi: '1990-01-01',
  };
}

async function callback({ sessionId, code, state, ip, userAgent }) {
  const raw = await redis.get(sessionKey(sessionId));
  if (!raw) throw errors.gone('Oturum bulunamadı veya süresi dolmuş', undefined, 'session_expired');
  const session = JSON.parse(raw);

  if (state && session.state !== state) {
    throw errors.make(400, 'invalid_oauth_code', 'State eşleşmiyor');
  }

  let kimlik;
  if (env.edevlet.mockMode) {
    kimlik = buildMockKimlik();
  } else {
    try {
      const info = await fetchUserInfoFromEdevlet(code);
      kimlik = {
        tcKimlik: info.tckn || info.tc_kimlik_no,
        ad: info.ad,
        soyad: info.soyad,
        dogumTarihi: info.dogum_tarihi,
      };
    } catch (err) {
      logger.error('e-Devlet user-info hata', { error: err.message });
      throw errors.make(400, 'invalid_oauth_code', 'e-Devlet kimlik bilgileri alınamadı');
    }
  }

  await redis.del(sessionKey(sessionId));

  const existing = await db('users').where({ tc_kimlik: kimlik.tcKimlik, is_active: true }).first();

  if (existing) {
    await writeAudit({
      userId: existing.id,
      action: 'auth.login',
      ip,
      userAgent,
      payload: { method: 'edevlet' },
    });
    return finalizeExistingUser(existing, kimlik, ip, userAgent);
  }

  // Yeni kullanıcı için kısa süreli registration token
  const registrationToken = signRegistrationToken({
    sub: null,
    tcKimlik: kimlik.tcKimlik,
    ad: kimlik.ad,
    soyad: kimlik.soyad,
    dogumTarihi: kimlik.dogumTarihi,
    source: 'edevlet',
  });

  return {
    accessToken: registrationToken, // FE shape uyumu için (onboarding tamamlanana kadar)
    refreshToken: null,
    expiresIn: registrationTokenSeconds(),
    isExisting: false,
    user: {
      id: null,
      tcKimlik: kimlik.tcKimlik,
      ad: kimlik.ad,
      soyad: kimlik.soyad,
      dogumTarihi: toDateOnly(kimlik.dogumTarihi),
      phone: null,
      eposta: null,
      profileComplete: false,
    },
  };
}

async function finalizeExistingUser(user, kimlik, ip, userAgent) {
  const accessToken = signAccessToken({ sub: user.id });
  const refreshTokenId = uuidv4();
  const refreshToken = signRefreshToken({ sub: user.id, jti: refreshTokenId });

  const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  await db('refresh_tokens').insert({
    id: refreshTokenId,
    user_id: user.id,
    token_hash: refreshHash,
    user_agent: userAgent || null,
    ip: ip || null,
    expires_at: new Date(Date.now() + 7 * 86400 * 1000),
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: accessTokenSeconds(),
    isExisting: true,
    user: {
      id: user.id,
      tcKimlik: user.tc_kimlik,
      ad: user.ad,
      soyad: user.soyad,
      dogumTarihi: toDateOnly(user.dogum_tarihi),
      phone: user.phone,
      eposta: user.eposta,
      profileComplete: !!user.profile_complete,
    },
  };
}

module.exports = { initiate, callback, buildMockKimlik };
