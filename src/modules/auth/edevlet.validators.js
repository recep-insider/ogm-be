'use strict';

const Joi = require('joi');

const initiateSchema = Joi.object({
  callbackScheme: Joi.string().min(2).max(64).default('ogmgonullu'),
});

const callbackSchema = Joi.object({
  sessionId: Joi.string().uuid().required(),
  code: Joi.string().min(1).required(),
  state: Joi.string().min(1).optional(),
});

module.exports = { initiateSchema, callbackSchema };
