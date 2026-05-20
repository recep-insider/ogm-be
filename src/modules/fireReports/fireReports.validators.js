'use strict';

const Joi = require('joi');

const NEEDS = ['lojistik', 'su_kumanya', 'ilk_yardim', 'el_telsizi'];

const fireReportDataSchema = Joi.object({
  coordinates: Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
  }).required(),
  needs: Joi.array().items(Joi.string().valid(...NEEDS)).default([]),
  description: Joi.string().max(1000).allow('', null).optional(),
});

const adminStatusSchema = Joi.object({
  status: Joi.string().valid('confirmed', 'rejected').required(),
  note: Joi.string().max(500).optional(),
});

module.exports = { fireReportDataSchema, adminStatusSchema, NEEDS };
