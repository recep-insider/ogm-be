'use strict';

const Joi = require('joi');

const phonePattern = /^\+\d{10,15}$/;

const sendOtpSchema = Joi.object({
  phone: Joi.string().pattern(phonePattern).required().messages({
    'string.pattern.base': 'Telefon E.164 formatında olmalı (örn. +905321234567)',
  }),
});

const verifyOtpSchema = Joi.object({
  sessionId: Joi.string().uuid().required(),
  code: Joi.string().pattern(/^\d{4,8}$/).required(),
});

const resendOtpSchema = Joi.object({
  sessionId: Joi.string().uuid().required(),
});

module.exports = { sendOtpSchema, verifyOtpSchema, resendOtpSchema };
