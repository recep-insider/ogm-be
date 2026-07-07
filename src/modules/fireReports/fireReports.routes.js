'use strict';

const { Router } = require('express');
const asyncHandler = require('../../shared/async-handler');
const { optionalAuth } = require('../../middlewares/auth');
const { fireReportUpload } = require('../../middlewares/upload');
const controller = require('./fireReports.controller');

const router = Router();

/**
 * @openapi
 * /fire-reports:
 *   post:
 *     tags: [Fire Reports]
 *     summary: Yangın ihbarı (multipart, media[] min 1) — guest (token'sız) da gönderebilir
 *     security: [ {}, { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [data, media]
 *             properties:
 *               data:
 *                 type: string
 *                 description: 'JSON: { coordinates, needs[], description }'
 *               media:
 *                 type: array
 *                 description: 'Görsel ≤ maxDocBytes (10MB), video ≤ maxVideoBytes (100MB)'
 *                 items: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Bildirim alındı
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *                 report: { $ref: '#/components/schemas/FireReportSummary' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       413: { $ref: '#/components/responses/PayloadTooLarge' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */
// Yangın ihbarı acil akıştır — token'sız (guest) gönderim kabul edilir; token
// varsa ihbar kullanıcıya bağlanır (üye olmadan devam senaryosu, kontrat 9.1).
router.post('/', optionalAuth, fireReportUpload, asyncHandler(controller.create));

module.exports = router;
