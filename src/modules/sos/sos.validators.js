'use strict';

const Joi = require('joi');

// mobil §4 / backend §12: SOS'ta SEBEP alanı yoktur — mobilde sebep girme adımı yok,
// bu metnin kaynağı da yok. Konum yalnızca koordinattır; serbest metin etiket alınmaz.
// Konum izni yoksa coordinates hiç gönderilmez — konumsuz imdat çağrısı da kabul edilir.
const sosSchema = Joi.object({
  coordinates: Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
  }).optional(),
});

module.exports = { sosSchema };
