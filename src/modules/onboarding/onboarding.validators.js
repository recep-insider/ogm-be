'use strict';

const Joi = require('joi');
const { validateTcKimlik } = require('../../shared/validate-tc-kimlik');

const phonePattern = /^\+\d{10,15}$/;
const namePattern = /^[A-Za-zÇĞİÖŞÜçğıöşüâîû\s']+$/;

const tcKimlikJoi = Joi.string()
  .length(11)
  .pattern(/^[1-9]\d{10}$/)
  .custom((value, helpers) => {
    if (!validateTcKimlik(value)) {
      return helpers.error('any.invalid');
    }
    return value;
  })
  .messages({ 'any.invalid': 'Geçerli bir TC Kimlik numarası giriniz' });

function over18(date, helpers) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return helpers.error('date.base');
  const now = new Date();
  if (d.getTime() >= now.getTime()) return helpers.error('any.invalid');
  const age = now.getFullYear() - d.getFullYear() -
    (now < new Date(now.getFullYear(), d.getMonth(), d.getDate()) ? 1 : 0);
  if (age < 18) return helpers.error('any.invalid');
  return date;
}

const kimlik = Joi.object({
  tcKimlik: tcKimlikJoi.required(),
  ad: Joi.string().min(1).max(100).pattern(namePattern).required(),
  soyad: Joi.string().min(1).max(100).pattern(namePattern).required(),
  dogumTarihi: Joi.alternatives()
    .try(Joi.date().iso(), Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/))
    .custom(over18)
    .required()
    .messages({ 'any.invalid': '18 yaşından küçük olanlar başvuramaz' }),
});

const iletisim = Joi.object({
  telefon: Joi.string().pattern(phonePattern).optional().allow('', null),
  eposta: Joi.string().email().required(),
  adres: Joi.string().min(10).max(500).required(),
});

const KAN_GRUBU = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', '0+', '0-'];
const OGRENIM = ['Lise', 'Ön Lisans', 'Lisans', 'Yüksek Lisans', 'Doktora', 'Diğer'];
const MESLEK = ['Memur', 'Öğretmen', 'Mühendis', 'Öğrenci', 'Emekli', 'Diğer'];
const YAKINLIK = ['Anne', 'Baba', 'Eş', 'Kardeş', 'Arkadaş', 'Diğer'];

const kisisel = Joi.object({
  kanGrubu: Joi.string().valid(...KAN_GRUBU).required(),
  ogrenim: Joi.string().valid(...OGRENIM).required(),
  meslek: Joi.string().valid(...MESLEK).required(),
  meslekDiger: Joi.alternatives().conditional('meslek', {
    is: 'Diğer',
    then: Joi.string().min(2).max(100).required(),
    otherwise: Joi.any().valid(null, '').optional(),
  }),
  hobiler: Joi.array().items(Joi.string().min(1).max(100)).min(1).required(),
});

const acil = Joi.object({
  ad: Joi.string().min(1).max(100).pattern(namePattern).required(),
  soyad: Joi.string().min(1).max(100).pattern(namePattern).required(),
  telefon: Joi.string().pattern(phonePattern).required(),
  yakinlik: Joi.string().valid(...YAKINLIK).required(),
});

const onboardingSchema = Joi.object({
  kimlik: kimlik.required(),
  iletisim: iletisim.required(),
  kisisel: kisisel.required(),
  acil: acil.required(),
});

module.exports = { onboardingSchema };
