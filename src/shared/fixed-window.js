'use strict';

const { errors } = require('./errors');

// Sabit pencereli sayaç: önce artırılır, eşzamanlı istekler de sınırı aşamaz.
// INCR ve EXPIRE NX tek MULTI'de çalışır; sayaç hiçbir durumda TTL'siz kalmaz (EXPIRE NX: Redis 7+).
async function hitFixedWindow(redis, key, { max, windowSec, message, code = 'rate_limited' }) {
  const results = await redis.multi().incr(key).expire(key, windowSec, 'NX').ttl(key).exec();
  const failed = results.find(([err]) => err);
  if (failed) throw failed[0];
  const [[, count], , [, ttl]] = results;
  if (count <= max) return;
  throw errors.make(429, code, message, { retryAfterSec: ttl > 0 ? ttl : windowSec });
}

module.exports = { hitFixedWindow };
