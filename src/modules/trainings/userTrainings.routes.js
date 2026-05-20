'use strict';

const { Router } = require('express');
const asyncHandler = require('../../shared/async-handler');
const { requireAuth } = require('../../middlewares/auth');
const service = require('./trainings.service');

const router = Router();

router.use(requireAuth);

/**
 * @openapi
 * /users/me/trainings:
 *   get:
 *     tags: [Trainings]
 *     summary: Aldığım eğitimler
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200:
 *         description: Tamamlanan/sürdürülen eğitimler
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/CompletedTraining' }
 */
router.get('/', asyncHandler(async (req, res) => {
  res.status(200).json(await service.listCompleted(req.user.id));
}));

/**
 * @openapi
 * /users/me/trainings/{id}/certificate:
 *   get:
 *     tags: [Trainings]
 *     summary: Eğitim sertifika indirme linki
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Sertifika URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url: { type: string, format: uri }
 *       404: { description: 'certificate_not_issued' }
 */
router.get('/:id/certificate', asyncHandler(async (req, res) => {
  res.status(200).json(await service.getCertificate(req.user.id, req.params.id));
}));

module.exports = router;
