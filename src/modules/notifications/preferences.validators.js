'use strict';

const Joi = require('joi');

const updatePreferencesSchema = Joi.object({
  taskCalls: Joi.boolean().optional(),
  trainings: Joi.boolean().optional(),
  announcements: Joi.boolean().optional(),
  distanceKm: Joi.number().integer().min(0).optional(),
}).min(1);

module.exports = { updatePreferencesSchema };
