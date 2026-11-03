'use strict';

const { errors } = require('./errors');
const logger = require('../config/logger');
const { guardRedis } = require('./redis-guard');

// Sabit pencereli sayaç: önce artırılır, eşzamanlı istekler de sınırı aşamaz.
// INCR ve EXPIRE NX tek MULTI'de çalışır; sayaç hiçbir durumda TTL'siz kalmaz (EXPIRE NX: Redis 7+).
// failOpen: sayaç tutulamazsa (Redis hatası) sınır uygulanmaz; gönüllünün SOS ve ihbarı Redis kesintisinde
// de işlenmeli (K23). Sınır aşımı (429) her durumda geçerlidir.
async function hitFixedWindow(redis, key, { max, windowSec, message, code = 'rate_limited', failOpen = false }) {
  let results;
  try {
    results = await guardRedis(redis, async () => {
      const out = await redis.multi().incr(key).expire(key, windowSec, 'NX').ttl(key).exec();
      const failed = out.find(([err]) => err);
      if (failed) throw failed[0];
      return out;
    });
  } catch (err) {
    if (!failOpen) throw err;
    logger.warn('Hız sınırı sayacı tutulamadı; istek sınırsız işleniyor', { key: key.split(':').slice(0, 2).join(':'), error: err.message });
    return;
  }
  const [[, count], , [, ttl]] = results;
  if (count <= max) return;
  throw errors.make(429, code, message, { retryAfterSec: ttl > 0 ? ttl : windowSec });
}

module.exports = { hitFixedWindow };
