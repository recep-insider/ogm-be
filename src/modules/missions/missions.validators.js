'use strict';

const Joi = require('joi');

const scanSchema = Joi.object({
  userId: Joi.string().required(),
  scannedAt: Joi.string().isoDate().optional(),
  token: Joi.string().optional(),
});

module.exports = { scanSchema };
