'use strict';

const { Router } = require('express');
const asyncHandler = require('../../shared/async-handler');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const service = require('./preferences.service');
const { updatePreferencesSchema } = require('./preferences.validators');

const router = Router();

router.use(requireAuth);

/**
 * @openapi
 * /users/me/notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: Bildirim tercihleri
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200:
 *         description: Tercihler
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/NotificationPreferences' }
 *   patch:
 *     tags: [Notifications]
 *     summary: Bildirim tercihlerini güncelle
 *     description: 'Request `distanceKm` (flat) gönderilir; response `distance:{km,min,max}` (nested) döner.'
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               taskCalls: { type: boolean }
 *               trainings: { type: boolean }
 *               announcements: { type: boolean }
 *               distanceKm: { type: integer }
 *     responses:
 *       200:
 *         description: Güncellenmiş tercihler
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/NotificationPreferences' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 */
router.get('/', asyncHandler(async (req, res) => {
  res.status(200).json(await service.get(req.user.id));
}));

router.patch('/', validate({ body: updatePreferencesSchema }), asyncHandler(async (req, res) => {
  res.status(200).json(await service.update(req.user.id, req.body));
}));

module.exports = router;
