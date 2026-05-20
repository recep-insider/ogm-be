'use strict';

const { Router } = require('express');
const asyncHandler = require('../../shared/async-handler');
const { requireAuth } = require('../../middlewares/auth');
const service = require('./trainings.service');

const router = Router();

router.use(requireAuth);

/**
 * @openapi
 * /trainings/online:
 *   get:
 *     tags: [Trainings]
 *     summary: Online eğitim listesi (kullanıcı bazlı progress)
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200:
 *         description: Online eğitimler
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/OnlineTraining' }
 */
router.get('/online', asyncHandler(async (req, res) => {
  res.status(200).json(await service.listOnline(req.user.id));
}));

/**
 * @openapi
 * /trainings/saha:
 *   get:
 *     tags: [Trainings]
 *     summary: Saha eğitim listesi
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200:
 *         description: Saha eğitimleri
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/SahaTraining' }
 */
router.get('/saha', asyncHandler(async (req, res) => {
  res.status(200).json(await service.listSaha(req.user.id));
}));

/**
 * @openapi
 * /trainings/{id}/applications:
 *   post:
 *     tags: [Trainings]
 *     summary: Saha eğitimine başvur
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Başvuru alındı
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 applicationId: { type: string }
 *                 status: { type: string, example: pending }
 *       409: { description: 'already_applied' }
 *       410: { description: 'training_full | training_closed' }
 */
router.post('/:id/applications', asyncHandler(async (req, res) => {
  const result = await service.applySaha(req.user.id, req.params.id, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  res.status(200).json(result);
}));

module.exports = router;
