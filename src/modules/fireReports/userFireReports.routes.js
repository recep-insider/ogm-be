'use strict';

const { Router } = require('express');
const asyncHandler = require('../../shared/async-handler');
const { requireAuth } = require('../../middlewares/auth');
const controller = require('./fireReports.controller');

const router = Router();

router.use(requireAuth);

/**
 * @openapi
 * /users/me/fire-reports:
 *   get:
 *     tags: [Fire Reports]
 *     summary: Kendi yangın bildirimlerim
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200:
 *         description: Bildirim listesi
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/FireReportSummary' }
 */
router.get('/', asyncHandler(controller.listMine));

module.exports = router;
