'use strict';

const { Router } = require('express');
const Joi = require('joi');
const asyncHandler = require('../../shared/async-handler');
const validate = require('../../middlewares/validate');
const { requireAdmin } = require('../../middlewares/auth');
const fireReportsController = require('../fireReports/fireReports.controller');
const { adminStatusSchema } = require('../fireReports/fireReports.validators');
const missionsService = require('../missions/missions.service');

const router = Router();

router.use(requireAdmin);

/**
 * @openapi
 * /admin/fire-reports/{id}:
 *   put:
 *     tags: [Admin]
 *     summary: Yangın bildirimi statü geçişi (panel)
 *     description: 'Mobil uygulamadan ÇAĞRILMAZ. x-api-key (admin) gerektirir.'
 *     security: [ { adminApiKey: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [confirmed, rejected] }
 *               note: { type: string }
 *     responses:
 *       200: { description: Güncellendi }
 */
router.put(
  '/fire-reports/:id',
  validate({ body: adminStatusSchema }),
  asyncHandler(fireReportsController.adminSetStatus),
);

const photoModerationSchema = Joi.object({
  status: Joi.string().valid('approved', 'rejected').required(),
});

/**
 * @openapi
 * /admin/missions/{id}/photos/{submissionId}:
 *   put:
 *     tags: [Admin]
 *     summary: Görev fotoğrafı moderasyonu (panel)
 *     security: [ { adminApiKey: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: submissionId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [approved, rejected] }
 *     responses:
 *       200: { description: Güncellendi }
 */
router.put(
  '/missions/:id/photos/:submissionId',
  validate({ body: photoModerationSchema }),
  asyncHandler(async (req, res) => {
    const result = await missionsService.moderatePhoto(
      req.params.id,
      req.params.submissionId,
      req.body,
      { userId: req.user?.id || null, role: req.actor?.role },
    );
    res.status(200).json(result);
  }),
);

module.exports = router;
