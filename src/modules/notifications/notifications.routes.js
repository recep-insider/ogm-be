'use strict';

const { Router } = require('express');
const asyncHandler = require('../../shared/async-handler');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const controller = require('./notifications.controller');
const { registerSchema } = require('./notifications.validators');

const router = Router();

router.use(requireAuth);

/**
 * @openapi
 * /notifications/devices:
 *   post:
 *     tags: [Notifications]
 *     summary: FCM cihaz token'ı kaydet
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, platform]
 *             properties:
 *               token: { type: string }
 *               platform: { type: string, enum: [ios, android, web] }
 *               appVersion: { type: string, example: '1.0.0' }
 *     responses:
 *       201:
 *         description: Kayıt tamam
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string, format: uuid }
 */
router.post('/devices', validate({ body: registerSchema }), asyncHandler(controller.register));

/**
 * @openapi
 * /notifications/devices/{tokenId}:
 *   delete:
 *     tags: [Notifications]
 *     summary: Cihaz token'ını kaldır (logout)
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: tokenId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204: { description: 'Kaldırıldı' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete('/devices/:tokenId', asyncHandler(controller.remove));

module.exports = router;
