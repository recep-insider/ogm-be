'use strict';

const { Router } = require('express');
const asyncHandler = require('../../shared/async-handler');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const service = require('./emergency.service');
const { emergencySchema } = require('./emergency.validators');

const router = Router();

/**
 * @openapi
 * /emergency:
 *   post:
 *     tags: [Emergency]
 *     summary: Acil durum bildirimi
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               missionId: { type: string, nullable: true }
 *               coordinates:
 *                 type: object
 *                 properties:
 *                   lat: { type: number }
 *                   lng: { type: number }
 *               message: { type: string }
 *     responses:
 *       200:
 *         description: Acil bildirim alındı
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *                 reportId: { type: string }
 *                 submittedAt: { type: string, format: date-time }
 *                 dispatchedTo: { type: string }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */
router.post('/', requireAuth, validate({ body: emergencySchema }), asyncHandler(async (req, res) => {
  const result = await service.create({
    userId: req.user.id,
    body: req.body,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  res.status(200).json(result);
}));

module.exports = router;
