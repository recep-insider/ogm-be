'use strict';

const crypto = require('crypto');
const { redis } = require('../config/redis');
const logger = require('../config/logger');
const { errors } = require('../shared/errors');

const MAX_KEY_LENGTH = 200;
const PENDING_TTL_SEC = 60;
const HEARTBEAT_MS = 20000;
const DONE_TTL_SEC = 86400;

function logRedisError(err) {
  logger.warn('Idempotency: Redis hatası, anahtarsız devam ediliyor', { error: err.message });
}

// İşleyici yanıt verene kadar pending anahtar uzatılır, süre sınırı yoktur: uzun işlem kilidini
// kaybedip ikinci kez çalışmasın. Süreç çökerse anahtar PENDING_TTL_SEC içinde düşer.
// ponytail: hiç yanıt vermeyen işleyici anahtarı süreç yeniden başlayana kadar tutar (tekrar
// deneme 409 alır); asılı işlem sorun olursa işleyiciye zaman aşımı eklenmeli, buraya değil.
// İstemci bağlantıyı kopardığında anahtar silinmez: işleyici sürerken aynı anahtarla ikinci kayıt açılmasın.
// 5xx'te de silinmez (hangi yöntemle gönderilirse gönderilsin): yan etki (push/SMS) kısmen gitmiş
// olabilir; anahtar son uzatmadan kalan 40–60 sn içinde düşer.
// res.json gövdeyi saklar; json dışı yanıtlar (send/sendStatus/end) res.end'de sonuçlanır.
function track(res, redisKey, hash) {
  let settled = false;
  const heartbeat = setInterval(() => {
    redis.expire(redisKey, PENDING_TTL_SEC).catch(logRedisError);
  }, HEARTBEAT_MS);
  heartbeat.unref();
  const settle = (json) => {
    if (settled) return;
    settled = true;
    clearInterval(heartbeat);
    const status = res.statusCode;
    if (status >= 500) return;
    // Yalnız JSON gövdesi tekrar oynatılabilir; diğer 2xx ve 4xx anahtarı serbest bırakır.
    if (json && status >= 200 && status < 300) {
      const done = JSON.stringify({ state: 'done', hash, status, body: json.body });
      redis.set(redisKey, done, 'EX', DONE_TTL_SEC)
        .catch(() => redis.set(redisKey, done, 'EX', DONE_TTL_SEC))
        .catch(logRedisError);
    } else {
      redis.del(redisKey).catch(logRedisError);
    }
  };
  const json = res.json.bind(res);
  res.json = (body) => {
    settle({ body });
    return json(body);
  };
  const end = res.end.bind(res);
  res.end = (...args) => {
    settle(null);
    return end(...args);
  };
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
