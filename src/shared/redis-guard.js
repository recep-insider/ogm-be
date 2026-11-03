'use strict';

const { AppError, errors } = require('./errors');
const logger = require('../config/logger');

// Redis kesintisinde giriş, SMS kodu ve hız sınırı yolları 3–6 sn bekleyip 500 dönmesin (BUG-024):
// bağlantı düşükse hemen, yanıt gecikirse kısa sürede 503 döner. Redis hatası "kayıt yok" sayılmaz
// (PA-41555); sınır ya da oturum doğrulanamıyorsa istek işlenmez. Zaman aşımı komutu iptal etmez:
// gönderilmiş komut Redis'te sonradan yine uygulanabilir; bu hata maybeApplied taşır.
const DOWN_STATUSES = new Set(['close', 'reconnecting', 'end']);
const TIMEOUT_MS = 1000;
const TIMED_OUT = new Error('Redis yanıt vermedi');

function unavailable(maybeApplied = false) {
  const err = errors.make(503, 'service_unavailable', 'Servis geçici olarak kullanılamıyor; lütfen biraz sonra tekrar deneyin.');
  if (maybeApplied) err.maybeApplied = true;
  return err;
}

async function guardRedis(redis, run, timeoutMs = TIMEOUT_MS) {
  if (DOWN_STATUSES.has(redis.status)) throw unavailable();
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(TIMED_OUT), timeoutMs);
  });
  try {
    return await Promise.race([run(), timeout]);
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn('Redis komutu başarısız', { error: err.message });
    throw unavailable(err === TIMED_OUT);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Kodu doğrulanmış oturumu siler. Silme gönderilip yanıtı geciktiyse Redis onu yine uygular; akış
 * 503'le kesilirse kişi hem kodu hem oturumu kaybeder ve yeni SMS ister. Bu durumda akış sürer.
 * ponytail: ioredis komutu yeniden deneme sınırında düşürürse oturum TTL'i dolana kadar kalır.
 */
async function delVerifiedSession(client, key) {
  try {
    await client.del(key);
  } catch (err) {
    if (!err.maybeApplied) throw err;
  }
}

/** get/set/del/ttl'i guardRedis üzerinden çalıştıran ince sarmalayıcı. */
function guardedClient(redis) {
  const wrap = (cmd) => (...args) => guardRedis(redis, () => redis[cmd](...args));
  return { get: wrap('get'), set: wrap('set'), del: wrap('del'), ttl: wrap('ttl') };
}

module.exports = { guardRedis, guardedClient, delVerifiedSession, TIMEOUT_MS };
