'use strict';

const Joi = require('joi');

const emergencySchema = Joi.object({
  missionId: Joi.string().allow(null, '').optional(),
  coordinates: Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
  }).optional(),
  message: Joi.string().max(1000).allow('', null).optional(),
});

module.exports = { emergencySchema };
