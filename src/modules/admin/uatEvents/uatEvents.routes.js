'use strict';

const { Router } = require('express');
const Joi = require('joi');
const asyncHandler = require('../../../shared/async-handler');
const validate = require('../../../middlewares/validate');
const { requireAdmin } = require('../../../middlewares/auth');
const { insertEvents } = require('./uatEvents.service');

const router = Router();

router.use(requireAdmin);

const TYPES = ['session_start', 'page_view', 'click', 'field_focus', 'field_change', 'api', 'message', 'js_error', 'inventory', 'lost'];

const str = (max) => Joi.string().max(max).allow('', null);

const detailSchema = Joi.object({
  role: str(20),
  ua: str(255),
  lang: str(20),
  viewport: str(20),
  screen: str(20),
  tz: str(60),
  query: str(255),
  inputType: str(20),
  status: Joi.number().integer(),
  code: str(64),
  ms: Joi.number().integer().min(0),
  level: str(10),
  source: str(255),
  keys: Joi.array().items(Joi.string().max(160)).max(300),
  count: Joi.number().integer().min(0),
}).allow(null);

const bodySchema = Joi.object({
  sessionId: Joi.string().max(36).required(),
  events: Joi.array()
    .items(
      Joi.object({
        seq: Joi.number().integer().min(0).required(),
        at: Joi.number().integer().min(0).required(),
        type: Joi.string().valid(...TYPES).required(),
        page: str(120),
        context: str(120),
        target: str(255),
        detail: detailSchema,
      }),
    )
    .min(1)
    .max(200)
    .required(),
});

/**
 * @openapi
 * /admin/uat-events:
 *   post:
 *     tags: [Admin]
 *     summary: UAT etkileşim olaylarını toplu kaydet (panel)
 *     description: 'Kullanıcı token''dan alınır. Aynı sessionId+seq ikinci kez gelirse yok sayılır. Alan değerleri gönderilmez; detail yalnız izinli anahtarları taşır.'
 *     security: [ { panelBearer: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, events]
 *             properties:
 *               sessionId: { type: string, maxLength: 36 }
 *               events:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 200
 *                 items:
 *                   type: object
 *                   required: [seq, at, type]
 *                   properties:
 *                     seq: { type: integer, minimum: 0 }
 *                     at: { type: integer, minimum: 0, description: 'İstemci zamanı (ms)' }
 *                     type: { type: string, enum: [session_start, page_view, click, field_focus, field_change, api, message, js_error, inventory, lost] }
 *                     page: { type: string, maxLength: 120, nullable: true }
 *                     context: { type: string, maxLength: 120, nullable: true }
 *                     target: { type: string, maxLength: 255, nullable: true }
 *                     detail: { type: object, nullable: true }
 *     responses:
 *       204: { description: Kaydedildi }
 *       400: { description: 'validation_error' }
 *       401: { description: 'unauthorized (süresi dolmuş token)' }
 *       403: { description: 'forbidden (token yok) | password_change_required' }
 */
router.post(
  '/',
  validate({ body: bodySchema }),
  asyncHandler(async (req, res) => {
    await insertEvents(req.panelUser.id, req.body);
    res.status(204).end();
  }),
);

module.exports = router;
