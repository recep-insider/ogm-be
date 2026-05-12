'use strict';

const { Router } = require('express');
const asyncHandler = require('../../shared/async-handler');
const { optionalAuth } = require('../../middlewares/auth');
const { reportUpload } = require('../../middlewares/upload');
const controller = require('./reports.controller');

const router = Router();

/**
 * @openapi
 * /reports/fire:
 *   post:
 *     tags: [Reports]
 *     summary: Yangın bildirimi (multipart)
 *     description: |
 *       Giriş yapmış veya guest kullanıcı tarafından yapılabilir.
 *       Rate limit: kullanıcı başına saatte 5, anonim IP başına saatte 3.
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [latitude, longitude]
 *             properties:
 *               latitude: { type: number, format: float }
 *               longitude: { type: number, format: float }
 *               accuracyM: { type: number, format: float }
 *               description: { type: string, maxLength: 500 }
 *               photos:
 *                 type: array
 *                 items: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Bildirim alındı
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 reportId: { type: string, format: uuid }
 *                 status: { type: string, enum: [received, dispatched, closed] }
 *                 createdAt: { type: string, format: date-time }
 *                 etaResponseSec: { type: integer }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */
router.post('/fire', optionalAuth, reportUpload, asyncHandler(controller.fire));

module.exports = router;
