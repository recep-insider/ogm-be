'use strict';

const { Router } = require('express');
const asyncHandler = require('../../shared/async-handler');
const validate = require('../../middlewares/validate');
const { requireAuth, requireOfficer } = require('../../middlewares/auth');
const { missionPhotoUpload } = require('../../middlewares/upload');
const controller = require('./missions.controller');
const { scanSchema } = require('./missions.validators');

const router = Router();

/**
 * @openapi
 * /missions/active:
 *   get:
 *     tags: [Missions]
 *     summary: Aktif görev listesi (Anasayfa)
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: lat
 *         schema: { type: number }
 *       - in: query
 *         name: lng
 *         schema: { type: number }
 *     responses:
 *       200:
 *         description: Aktif görevler
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/ActiveMissionSummary' }
 */
router.get('/active', requireAuth, asyncHandler(controller.listActive));

/**
 * @openapi
 * /missions/active/{id}:
 *   get:
 *     tags: [Missions]
 *     summary: Aktif görev detayı
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Görev detayı
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ActiveMissionDetail' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/active/:id', requireAuth, asyncHandler(controller.getActive));

/**
 * @openapi
 * /missions/active/{id}/join:
 *   post:
 *     tags: [Missions]
 *     summary: Göreve katıl (userStatus → accepted)
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Katılım onaylandı
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *                 userStatus: { type: string, example: accepted }
 *       403: { description: 'equipment_required' }
 *       409: { description: 'mission_full | already_joined' }
 */
router.post('/active/:id/join', requireAuth, asyncHandler(controller.join));

/**
 * @openapi
 * /missions/active/{id}/scan:
 *   post:
 *     tags: [Missions]
 *     summary: Saha amiri QR tarama (userStatus → on_site)
 *     description: |
 *       Mobil uygulamadan ÇAĞRILMAZ. Saha amiri (officer) `x-api-key` veya
 *       `role=officer` token ile çağırır. Opsiyonel `token` HMAC imzasıdır (B.1).
 *     security: [ { officerApiKey: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId]
 *             properties:
 *               userId: { type: string }
 *               scannedAt: { type: string, format: date-time }
 *               token: { type: string, description: 'opsiyonel HMAC imzası' }
 *     responses:
 *       200:
 *         description: on_site'a geçildi
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *                 userStatus: { type: string, example: on_site }
 */
router.post('/active/:id/scan', requireOfficer, validate({ body: scanSchema }), asyncHandler(controller.scan));

/**
 * @openapi
 * /missions/active/{id}/photos:
 *   post:
 *     tags: [Missions]
 *     summary: Görev fotoğrafı yükle (yalnızca on_site)
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Submission alındı
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *                 submissionId: { type: string }
 *                 status: { type: string, example: pending }
 *                 submittedAt: { type: string, format: date-time }
 *       403: { description: 'not_on_site' }
 */
router.post('/active/:id/photos', requireAuth, missionPhotoUpload, asyncHandler(controller.submitPhoto));

module.exports = router;
