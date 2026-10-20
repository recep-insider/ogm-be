'use strict';

const crypto = require('crypto');
const { redis } = require('../config/redis');
const logger = require('../config/logger');
const { errors } = require('../shared/errors');

const MAX_KEY_LENGTH = 200;
const PENDING_TTL_SEC = 60;
const HEARTBEAT_MS = 20000;
const MAX_HOLD_MS = 15 * 60 * 1000;
const DONE_TTL_SEC = 86400;

function logRedisError(err) {
  logger.warn('Idempotency: Redis hatası, anahtarsız devam ediliyor', { error: err.message });
}

// İşleyici sürdükçe pending anahtar uzatılır; süreç çökerse PENDING_TTL_SEC içinde düşer.
// İstemci bağlantıyı kopardığında anahtar silinmez: işleyici sürerken aynı anahtarla ikinci kayıt açılmasın.
// 5xx'te de silinmez: yan etki (push/SMS) kısmen gitmiş olabilir; tekrar deneme hemen yeniden çalıştırmasın.
function track(res, redisKey, hash) {
  let settled = false;
  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    if (Date.now() - startedAt > MAX_HOLD_MS) return clearInterval(heartbeat);
    redis.expire(redisKey, PENDING_TTL_SEC).catch(logRedisError);
  }, HEARTBEAT_MS);
  heartbeat.unref();
  const settle = () => {
    settled = true;
    clearInterval(heartbeat);
  };
  const json = res.json.bind(res);
  res.json = (body) => {
    settle();
    const status = res.statusCode;
    if (status >= 200 && status < 300) {
      const done = JSON.stringify({ state: 'done', hash, status, body });
      redis.set(redisKey, done, 'EX', DONE_TTL_SEC)
        .catch(() => redis.set(redisKey, done, 'EX', DONE_TTL_SEC))
        .catch(logRedisError);
    } else if (status < 500) {
      redis.del(redisKey).catch(logRedisError);
    }
    return json(body);
  };
  res.on('finish', () => {
    if (!settled) {
      settle();
      redis.del(redisKey).catch(logRedisError);
    }
  });
}

async function resolve(req, res, key) {
  const redisKey = `idem:${req.panelUser.id}:${req.method}:${req.baseUrl}${req.route.path}:${key}`;
  const hash = crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const claimed = await redis.set(redisKey, JSON.stringify({ state: 'pending', hash }), 'EX', PENDING_TTL_SEC, 'NX');
    if (claimed) {
      track(res, redisKey, hash);
      return null;
    }
    const raw = await redis.get(redisKey);
    if (raw === null) continue;
    const stored = JSON.parse(raw);
    if (stored.hash !== hash) {
      return { error: errors.business('Bu Idempotency-Key farklı bir istekle kullanılmış', undefined, 'idempotency_key_reused') };
    }
    if (stored.state === 'pending') {
      return { error: errors.conflict('Bu istek hâlâ işleniyor; birkaç saniye sonra listeyi kontrol edin', undefined, 'idempotency_in_flight') };
    }
    return { replay: stored };
  }
  return null;
}

function idempotent() {
  return async (req, res, next) => {
    const header = req.get('Idempotency-Key');
    if (header === undefined) return next();
    const key = header.trim();
    if (!key || key.length > MAX_KEY_LENGTH) {
      return next(errors.validation(
        `Idempotency-Key boş olamaz ve en fazla ${MAX_KEY_LENGTH} karakter olabilir`,
        undefined,
        'idempotency_key_invalid',
      ));
    }

    let outcome = null;
    try {
      outcome = await resolve(req, res, key);
    } catch (err) {
      logRedisError(err);
    }
    if (outcome?.error) return next(outcome.error);
    if (outcome?.replay) {
      res.set('Idempotent-Replayed', 'true');
      return res.status(outcome.replay.status).json(outcome.replay.body);
    }
    return next();
  };
}

module.exports = { idempotent };
