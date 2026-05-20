'use strict';

const { Router } = require('express');
const asyncHandler = require('../../shared/async-handler');
const { requireAuth } = require('../../middlewares/auth');
const service = require('./equipment.service');

const router = Router();

router.use(requireAuth);

/**
 * @openapi
 * /users/me/equipment:
 *   get:
 *     tags: [Equipment]
 *     summary: Zimmetli ekipman listesi
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200:
 *         description: Ekipman listesi
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/EquipmentItem' }
 */
router.get('/', asyncHandler(async (req, res) => {
  res.status(200).json(await service.listForUser(req.user.id));
}));

module.exports = router;
