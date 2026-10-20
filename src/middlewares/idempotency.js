'use strict';

const crypto = require('crypto');
const { redis } = require('../config/redis');
const logger = require('../config/logger');
const { errors } = require('../shared/errors');

const MAX_KEY_LENGTH = 200;
const PENDING_TTL_SEC = 300;
const DONE_TTL_SEC = 86400;

function logRedisError(err) {
  logger.warn('Idempotency: Redis hatası, anahtarsız devam ediliyor', { error: err.message });
}

// İstemci bağlantıyı kopardığında anahtar silinmez: işleyici sürerken aynı anahtarla ikinci kayıt açılmasın.
function track(res, redisKey, hash) {
  let settled = false;
  const json = res.json.bind(res);
  res.json = (body) => {
    settled = true;
    const status = res.statusCode;
    const op = status >= 200 && status < 300
      ? redis.set(redisKey, JSON.stringify({ state: 'done', hash, status, body }), 'EX', DONE_TTL_SEC)
      : redis.del(redisKey);
    op.catch(logRedisError);
    return json(body);
  };
  res.on('finish', () => {
    if (!settled) redis.del(redisKey).catch(logRedisError);
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
