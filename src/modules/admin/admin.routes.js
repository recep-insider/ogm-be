'use strict';

const { Router } = require('express');
const Joi = require('joi');
const asyncHandler = require('../../shared/async-handler');
const validate = require('../../middlewares/validate');
const { requireAdmin } = require('../../middlewares/auth');
const fireReportsController = require('../fireReports/fireReports.controller');
const { adminStatusSchema } = require('../fireReports/fireReports.validators');
const missionsService = require('../missions/missions.service');
const adminService = require('./admin.service');

const router = Router();

router.use(requireAdmin);

const applicationStatusSchema = Joi.object({
  status: Joi.string().valid(...adminService.APPLICATION_STATUSES).required(),
  note: Joi.string().max(1000).allow('', null).optional(),
});

/**
 * @openapi
 * /admin/users/{userId}/application:
 *   put:
 *     tags: [Admin]
 *     summary: Gönüllü başvuru durumunu güncelle (panel / onay)
 *     description: >-
 *       Mobil uygulamadan ÇAĞRILMAZ. x-api-key (admin) gerektirir.
 *       Kullanıcının en güncel başvurusunun status'unu günceller; bildirim göndermez.
 *     security: [ { adminApiKey: [] } ]
 *     parameters:
 *       - in: path
 *         name: userId
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
 *               status: { type: string, enum: [pending, approved, rejected, requires_revision] }
 *               note: { type: string, nullable: true }
 *     responses:
 *       200:
 *         description: Güncellendi
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 applicationId: { type: string }
 *                 userId: { type: string }
 *                 status: { type: string }
 *                 reviewedAt: { type: string, format: date-time }
 *       404: { description: 'application_not_found' }
 */
router.put(
  '/users/:userId/application',
  validate({ body: applicationStatusSchema }),
  asyncHandler(async (req, res) => {
    const result = await adminService.setApplicationStatus(req.params.userId, req.body, {
      userId: req.user?.id || null,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.status(200).json(result);
  }),
);

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
