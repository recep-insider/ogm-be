'use strict';

const Joi = require('joi');

// backend §5 + §12: "Sahadaki ihtiyaçlar" (needs) panelden tamamen kaldırıldı — mobil
// artık göndermez, API kabul etmez, okunacağı bir yer kalmadı.
// Konum ZORUNLUDUR (mobil §3): opsiyonel olduğu sürece "Bilinmeyen Konum" başlıklı
// kayıtlar oluşuyordu; panel de olay kaydını bu koordinatla önceden pinliyor.
const fireReportDataSchema = Joi.object({
  coordinates: Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
  }).required(),
  description: Joi.string().max(1000).allow('', null).optional(),
});

// §5: İhbar kapatma TEK SONUÇ üretir — "Yangın tespit edilmedi". Ret gerekçesi
// ALINMAZ; panelde ayrı bir gerekçe alanı yoktur, bu yüzden API de kabul etmez.
const adminStatusSchema = Joi.object({
  status: Joi.string().valid('confirmed', 'rejected').required(),
});

module.exports = { fireReportDataSchema, adminStatusSchema };
