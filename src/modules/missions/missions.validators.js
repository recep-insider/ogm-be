'use strict';

const Joi = require('joi');

// §13: kimlik QR (`OGM:VOL:{id}`), doğrudan userId veya — QR okutulamazsa yedek yöntem
// olarak — TC kimlik numarasıyla gelir.
const scanSchema = Joi.object({
  qr: Joi.string().max(120).optional(),
  userId: Joi.string().max(36).optional(),
  tcKimlik: Joi.string().length(11).pattern(/^\d+$/).optional(),
  scannedAt: Joi.string().isoDate().optional(),
  token: Joi.string().optional(),
}).or('qr', 'userId', 'tcKimlik');

// §3: gönüllünün mobilden verebileceği tek sinyal çifti.
const respondSchema = Joi.object({
  decision: Joi.string().valid('yolda', 'katilamiyor').required(),
});

module.exports = { scanSchema, respondSchema };
