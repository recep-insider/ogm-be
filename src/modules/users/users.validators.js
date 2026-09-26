'use strict';

const Joi = require('joi');
const { cityJoiValidator } = require('../../shared/regions');

const KAN_GRUBU = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', '0+', '0-'];
const OGRENIM = ['Lise', 'Ön Lisans', 'Lisans', 'Yüksek Lisans', 'Doktora', 'Diğer'];
const MESLEK = ['Memur', 'Öğretmen', 'Mühendis', 'Öğrenci', 'Emekli', 'Diğer'];
const YAKINLIK = ['Anne', 'Baba', 'Eş', 'Kardeş', 'Arkadaş', 'Diğer'];
const GIYSI_BEDENI = ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

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
  // mobil §11: il/ilçe dropdown — bölge kapsamı (backend §11) bu alandan eşleşir.
  // il 81 ilin kanonik adına normalize edilir (büyük/küçük harf, diakritik farkı kabul);
  // tanınmayan il 400 validation_error. İlçe serbest metin kalır.
  il: Joi.string()
    .trim()
    .max(60)
    .allow(null, '')
    .custom(cityJoiValidator)
    .messages({ 'any.invalid': 'Geçersiz il adı' })
    .optional(),
  ilce: Joi.string().trim().max(60).allow(null, '').optional(),
  kanGrubu: Joi.string().valid(...KAN_GRUBU).optional(),
  ogrenim: Joi.string().valid(...OGRENIM).optional(),
  meslek: Joi.string().valid(...MESLEK).optional(),
  meslekDiger: Joi.string().min(2).max(100).allow(null, '').optional(),
  hobiler: Joi.array().items(Joi.string().min(1).max(100)).optional(),
  giysiBedeni: Joi.string().valid(...GIYSI_BEDENI).allow(null).optional(),
  ayakkabiNumarasi: Joi.number().integer().min(34).max(50).allow(null).optional(),
  // mobil §11: STK üyeliği serbest metindir — enum'a bağlanmaz, dış entegrasyon yok.
  stkText: Joi.string().max(200).allow(null, '').optional(),
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
