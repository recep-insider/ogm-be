'use strict';

const { Router } = require('express');
const asyncHandler = require('../../shared/async-handler');
const { requireAuth } = require('../../middlewares/auth');
const service = require('./equipment.service');
const readinessService = require('../users/readiness.service');

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

/**
 * @openapi
 * /users/me/equipment/kkd:
 *   get:
 *     tags: [Equipment]
 *     summary: KKD seti — beş kalemin zimmet, ömür ve beden görünümü
 *     description: >-
 *       mobil-gereksinimleri.md §12: kalıcı/geçici ayrımı YOKTUR, tek set vardır. Elle
 *       "KKD tamam" işaretlemesi yoktur — durum zimmetten türer, ömrü dolan kalem otomatik düşer.
 *       Beden gönüllü profilinden okunur.
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200:
 *         description: 'items[]: itemKey, label, beden, serialNo, assignedAt, expiresAt, status'
 */
router.get('/kkd', asyncHandler(async (req, res) => {
  res.status(200).json({ items: await readinessService.kkdSet(req.user.id) });
}));

module.exports = router;
