'use strict';

const { errors } = require('./errors');

// Sabit pencereli sayaç: önce artırılır, eşzamanlı istekler de sınırı aşamaz.
async function hitFixedWindow(redis, key, { max, windowSec, message }) {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSec);
  if (count <= max) return;
  let ttl = await redis.ttl(key);
  if (ttl < 0) {
    await redis.expire(key, windowSec);
    ttl = windowSec;
  }
  throw errors.make(429, 'rate_limited', message, { retryAfterSec: ttl });
}

module.exports = { hitFixedWindow };
