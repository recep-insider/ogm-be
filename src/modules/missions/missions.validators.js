'use strict';

const Joi = require('joi');

// Çevrimdışı okutma kuyruğu geçmiş zamanı taşır; cihaz saati kayması için kısa bir ileri pay bırakılır.
const SCAN_CLOCK_SKEW_MS = 5 * 60 * 1000;
const SCAN_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

function scanTime(value, helpers) {
  const age = Date.now() - value.getTime();
  if (age < -SCAN_CLOCK_SKEW_MS) return helpers.message('Okutma zamanı gelecekte olamaz');
  if (age > SCAN_MAX_AGE_MS) return helpers.message('Okutma zamanı 7 günden eski olamaz');
  return value;
}

// §13: kimlik QR (`OGM:VOL:{id}`), doğrudan userId veya — QR okutulamazsa yedek yöntem
// olarak — TC kimlik numarasıyla gelir.
const scanSchema = Joi.object({
  qr: Joi.string().trim().max(120).optional(),
  userId: Joi.string().trim().max(36).optional(),
  tcKimlik: Joi.string().length(11).pattern(/^\d+$/).optional(),
  scannedAt: Joi.date().iso().custom(scanTime).optional(),
  token: Joi.string().optional(),
}).or('qr', 'userId', 'tcKimlik');

// §3: gönüllünün mobilden verebileceği tek sinyal çifti.
const respondSchema = Joi.object({
  decision: Joi.string().valid('yolda', 'katilamiyor').required(),
});

module.exports = { scanSchema, respondSchema };
