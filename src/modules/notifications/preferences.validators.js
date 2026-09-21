'use strict';

const Joi = require('joi');

// mobil §16: "Acil Bildirimler" kapatılamaz — bu yüzden istek gövdesinde acil için
// bir anahtar YOKTUR. Yarıçap gönüllünün kendi tercihidir (admin mesafe girmez) ve
// artık bir baz konumdan ölçülür.
const updatePreferencesSchema = Joi.object({
  taskCalls: Joi.boolean().optional(),
  trainings: Joi.boolean().optional(),
  announcements: Joi.boolean().optional(),
  distanceKm: Joi.number().integer().min(0).optional(),
  baseLocation: Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
    il: Joi.string().max(60).optional(),
    ilce: Joi.string().max(60).optional(),
  })
    .allow(null)
    .optional(),
}).min(1);

module.exports = { updatePreferencesSchema };
