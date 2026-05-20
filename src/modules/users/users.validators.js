'use strict';

const Joi = require('joi');

const KAN_GRUBU = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', '0+', '0-'];
const OGRENIM = ['Lise', 'Ön Lisans', 'Lisans', 'Yüksek Lisans', 'Doktora', 'Diğer'];
const MESLEK = ['Memur', 'Öğretmen', 'Mühendis', 'Öğrenci', 'Emekli', 'Diğer'];
const YAKINLIK = ['Anne', 'Baba', 'Eş', 'Kardeş', 'Arkadaş', 'Diğer'];

const acilSchema = Joi.object({
  ad: Joi.string().min(1).max(100).required(),
  soyad: Joi.string().min(1).max(100).required(),
  telefon: Joi.string().pattern(/^\+\d{10,15}$/).required(),
  yakinlik: Joi.string().valid(...YAKINLIK).required(),
});

const patchMeSchema = Joi.object({
  phone: Joi.string().pattern(/^\+\d{10,15}$/).optional(),
  eposta: Joi.string().email().optional(),
  adres: Joi.string().min(10).max(500).optional(),
  kanGrubu: Joi.string().valid(...KAN_GRUBU).optional(),
  ogrenim: Joi.string().valid(...OGRENIM).optional(),
  meslek: Joi.string().valid(...MESLEK).optional(),
  meslekDiger: Joi.string().min(2).max(100).allow(null, '').optional(),
  hobiler: Joi.array().items(Joi.string().min(1).max(100)).min(1).optional(),
  avatarUrl: Joi.string().uri().allow(null, '').optional(),
  acil: acilSchema.optional(),
}).min(1);

const consentSchema = Joi.object({
  document: Joi.string().valid('kvkk', 'aydinlatma', 'acik_riza').required(),
  version: Joi.string().min(1).max(32).required(),
});

const phoneChangeInitSchema = Joi.object({
  phone: Joi.string().pattern(/^\+\d{10,15}$/).required(),
});

const phoneChangeCommitSchema = Joi.object({
  sessionId: Joi.string().uuid().required(),
  code: Joi.string().pattern(/^\d{4,8}$/).required(),
});

module.exports = {
  patchMeSchema,
  acilSchema,
  consentSchema,
  phoneChangeInitSchema,
  phoneChangeCommitSchema,
};
