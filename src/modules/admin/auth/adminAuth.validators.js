'use strict';

const Joi = require('joi');

// Shared field rules so the login and the staff-creation schemas keep the same
// email/password policy (no drift between "set your password" and "log in").
const epostaField = Joi.string().email().max(254).messages({
  'string.email': 'Geçerli bir e-posta giriniz',
});
const sifreField = Joi.string().min(8).max(128).messages({
  'string.min': 'Şifre en az 8 karakter olmalı',
});

const loginSchema = Joi.object({
  eposta: epostaField.required(),
  sifre: sifreField.required(),
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

module.exports = { loginSchema, refreshSchema, epostaField, sifreField };
