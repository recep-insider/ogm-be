'use strict';

const { Router } = require('express');
const asyncHandler = require('../../shared/async-handler');
const { requireAuth } = require('../../middlewares/auth');
const { fireReportUpload } = require('../../middlewares/upload');
const controller = require('./fireReports.controller');

const router = Router();

/**
 * @openapi
 * /fire-reports:
 *   post:
 *     tags: [Fire Reports]
 *     summary: Yangın ihbarı (multipart, media[] min 1)
 *     security: [ { bearerAuth: [] } ]
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
 *       429: { $ref: '#/components/responses/RateLimited' }
 */
router.post('/', requireAuth, fireReportUpload, asyncHandler(controller.create));

module.exports = router;
