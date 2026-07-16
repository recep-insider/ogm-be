'use strict';

const axios = require('axios');
const env = require('../config/env');
const logger = require('../config/logger');

const PLACEHOLDER = 'Bilinmeyen Konum';

// OSM Nominatim kullanım politikası: saniyede en fazla 1 istek (ihlalde IP ban).
// Self-hosted container kullanılıyorsa da zararsız — ihbar hacmi saatte 5/kullanıcı.
const MIN_INTERVAL_MS = 1100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Kuyruk process başınadır (API ve backfill ayrı process → ayrı kuyruk).
let queue = Promise.resolve();
let lastRequestAt = 0;
let pending = 0;

/** İstekleri sıraya alıp aralarında en az MIN_INTERVAL_MS bırakır. */
function throttle(fn) {
  pending += 1;
  const result = queue.then(async () => {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return fn();
  });
  queue = result.then(
    () => {},
    () => {}
  );
  return result.finally(() => {
    pending -= 1;
  });
}

function fallback(lat, lng) {
  return { locationName: PLACEHOLDER, regionLabel: `${lat.toFixed(2)}, ${lng.toFixed(2)}` };
}

const DEADLINE = Symbol('deadline');

/**
 * ms içinde çözülmezse DEADLINE döner. Kuyruktaki istek iptal edilmez (OSM
 * aralığı bozulmasın diye) — sonucu yalnızca yok sayılır.
 */
function withDeadline(promise, ms) {
  if (!Number.isFinite(ms)) return promise;
  promise.catch(() => {}); // deadline kazanırsa geride kalan red yutulur
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(DEADLINE), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Koordinattan locationName/regionLabel türetir (Nominatim reverse geocode).
 * Servis tanımsız, yanıt maxWaitMs içinde gelmiyor veya istek başarısızsa
 * placeholder + koordinat metni döner — çağıran maxWaitMs'ten uzun beklemez.
 *
 * @param {{maxWaitMs?: number, timeoutMs?: number}} [opts] maxWaitMs kuyrukta
 *   bekleme + istek süresinin toplam üst sınırıdır (ihbar yazma yolu gibi
 *   gecikmeye duyarlı çağrılar vermeli); backfill sabırlı olabilir.
 *   timeoutMs asla 0 olmamalı: axios 0'ı "timeout yok" sayar, istek hiç
 *   sonlanmaz ve kuyruk o process'te kalıcı olarak kilitlenir.
 */
async function reverseGeocode(lat, lng, { maxWaitMs = Infinity, timeoutMs = 8000 } = {}) {
  if (!env.geo.nominatimUrl) return fallback(lat, lng);

  // Kuyruk zaten bütçeyi aşıyorsa isteği hiç açma: sonucu nasılsa deadline'a
  // takılıp atılacaktı — OSM'e boşuna istek gitmesin.
  if (pending * MIN_INTERVAL_MS > maxWaitMs) {
    logger.warn('Reverse geocode kuyruğu dolu — placeholder ile devam', { pending });
    return fallback(lat, lng);
  }

  try {
    const response = await withDeadline(
      throttle(() =>
        axios.get(`${env.geo.nominatimUrl.replace(/\/$/, '')}/reverse`, {
          params: { lat, lon: lng, format: 'jsonv2', 'accept-language': 'tr' },
          timeout: timeoutMs,
          headers: { 'User-Agent': 'ogm-gonullu-api' },
        })
      ),
      maxWaitMs
    );
    if (response === DEADLINE) {
      logger.warn('Reverse geocode maxWaitMs içinde yanıtlamadı — placeholder ile devam', { maxWaitMs });
      return fallback(lat, lng);
    }
    const { data } = response;
    const a = data.address || {};
    const locationName = data.name || a.neighbourhood || a.suburb || a.village || a.town || a.city || PLACEHOLDER;
    const region = [a.state || a.province, a.county || a.town || a.city].filter(Boolean).join(' / ');
    return { locationName, regionLabel: region || locationName };
  } catch (err) {
    logger.warn('Reverse geocode başarısız', { error: err.message });
    return fallback(lat, lng);
  }
}

module.exports = { reverseGeocode, PLACEHOLDER };
