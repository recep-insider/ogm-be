'use strict';

const { Router } = require('express');
const asyncHandler = require('../../shared/async-handler');
const { requireAuth } = require('../../middlewares/auth');
const controller = require('./missions.controller');

const router = Router();

router.use(requireAuth);

/**
 * @openapi
 * /users/me/missions:
 *   get:
 *     tags: [Missions]
 *     summary: Görev aldığım yangınlar (geçmiş)
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200:
 *         description: Görev geçmişi
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/FireMissionSummary' }
 */
router.get('/', asyncHandler(controller.listHistory));

/**
 * @openapi
 * /users/me/missions/{id}:
 *   get:
 *     tags: [Missions]
 *     summary: Geçmiş görev detayı
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
 *             schema: { $ref: '#/components/schemas/FireMissionDetail' }
 *       403: { description: 'not_participated' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', asyncHandler(controller.getHistory));

module.exports = router;
