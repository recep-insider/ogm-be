'use strict';

const Joi = require('joi');

const registerSchema = Joi.object({
  // Eski mobil sürümler FCM yokken `stub-` önekli sahte token üretiyordu; bunlara
  // hiçbir push ulaşamaz ve FCM'in ölü-token temizliği de onları tanımaz.
  token: Joi.string()
    .min(10)
    .max(256)
    .pattern(/^stub-/, { name: 'placeholder token', invert: true })
    .required()
    .messages({ 'string.pattern.invert.name': 'Geçersiz cihaz token\'ı' }),
  platform: Joi.string().valid('ios', 'android', 'web').required(),
  appVersion: Joi.string().max(32).optional(),
});

module.exports = { registerSchema };
