'use strict';

const Joi = require('joi');

// Konum izni yoksa coordinates hiç gönderilmez — boş body de geçerli olmalı,
// konumsuz imdat çağrısı da kabul edilir (operasyon merkezi arayarak konum alır).
const sosSchema = Joi.object({
  coordinates: Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
  }).optional(),
  message: Joi.string().max(500).allow('', null).optional(),
});

module.exports = { sosSchema };
