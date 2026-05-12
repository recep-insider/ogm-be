'use strict';

const { Router } = require('express');
const asyncHandler = require('../../shared/async-handler');
const { requireAuthOrRegistration } = require('../../middlewares/auth');
const { onboardingUpload } = require('../../middlewares/upload');
const controller = require('./onboarding.controller');

const router = Router();

/**
 * @openapi
 * /onboarding/complete:
 *   post:
 *     tags: [Onboarding]
 *     summary: Gönüllü başvurusunu tamamla (multipart upload)
 *     description: |
 *       Tek-shot transactional submit. `data` alanında JSON string olarak tüm form
 *       alanları, ayrıca `saglikRaporu` ve `sabikaKaydi` dosyaları yüklenir.
 *       Header'da `Authorization: Bearer <token>` — access token ya da
 *       OTP/e-Devlet sonrası alınan kısa süreli registration token kabul edilir.
 *     security:
 *       - bearerAuth: []
 *       - registrationToken: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [data, saglikRaporu, sabikaKaydi]
 *             properties:
 *               data:
 *                 type: string
 *                 description: JSON string (OnboardingData şeması)
 *               saglikRaporu:
 *                 type: string
 *                 format: binary
 *               sabikaKaydi:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Başvuru oluşturuldu
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 applicationId: { type: string, format: uuid }
 *                 status: { $ref: '#/components/schemas/ApplicationStatus' }
 *                 submittedAt: { type: string, format: date-time }
 *                 user: { $ref: '#/components/schemas/UserPublic' }
 *                 tokens:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     accessToken: { type: string }
 *                     refreshToken: { type: string }
 *                     expiresIn: { type: integer }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       409: { description: 'TC kimlik ile mevcut başvuru var' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/complete',
  requireAuthOrRegistration,
  onboardingUpload,
  asyncHandler(controller.complete),
);

module.exports = router;
