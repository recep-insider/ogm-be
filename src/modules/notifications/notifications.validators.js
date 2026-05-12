'use strict';

const Joi = require('joi');

const registerSchema = Joi.object({
  token: Joi.string().min(10).max(256).required(),
  platform: Joi.string().valid('ios', 'android', 'web').required(),
  appVersion: Joi.string().max(32).optional(),
});

module.exports = { registerSchema };
