'use strict';

const Joi = require('joi');

const fireSchema = Joi.object({
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
  accuracyM: Joi.number().min(0).optional(),
  description: Joi.string().max(500).allow('', null).optional(),
});

module.exports = { fireSchema };
