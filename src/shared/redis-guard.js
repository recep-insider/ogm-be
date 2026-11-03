'use strict';

const { AppError, errors } = require('./errors');
const logger = require('../config/logger');

// Redis kesintisinde giriş, SMS kodu ve hız sınırı yolları 3–6 sn bekleyip 500 dönmesin (BUG-024):
// bağlantı düşükse hemen, yanıt gecikirse kısa sürede 503 döner. Redis hatası "kayıt yok" sayılmaz
// (PA-41555); sınır ya da oturum doğrulanamıyorsa istek işlenmez.
const DOWN_STATUSES = new Set(['close', 'reconnecting', 'end']);
const TIMEOUT_MS = 1000;

function unavailable() {
  return errors.make(503, 'service_unavailable', 'Servis geçici olarak kullanılamıyor; lütfen biraz sonra tekrar deneyin.');
}

async function guardRedis(redis, run, timeoutMs = TIMEOUT_MS) {
  if (DOWN_STATUSES.has(redis.status)) throw unavailable();
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Redis yanıt vermedi')), timeoutMs);
  });
  try {
    return await Promise.race([run(), timeout]);
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn('Redis komutu başarısız', { error: err.message });
    throw unavailable();
  } finally {
    clearTimeout(timer);
  }
}

/** get/set/del'i guardRedis üzerinden çalıştıran ince sarmalayıcı. */
function guardedClient(redis) {
  const wrap = (cmd) => (...args) => guardRedis(redis, () => redis[cmd](...args));
  return { get: wrap('get'), set: wrap('set'), del: wrap('del') };
}

module.exports = { guardRedis, guardedClient, TIMEOUT_MS };
