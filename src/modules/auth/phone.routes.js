'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');

const validate = require('../../middlewares/validate');
const asyncHandler = require('../../shared/async-handler');
const controller = require('./phone.controller');
const schemas = require('./phone.validators');

const router = Router();

const sendOtpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 50,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'IP başına OTP isteği limiti aşıldı' } },
});

const verifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'OTP doğrulama limiti aşıldı' } },
});

/**
 * @openapi
 * /auth/phone/send-otp:
 *   post:
 *     tags: [Auth - Phone]
 *     summary: Telefon numarasına OTP gönder
 *     description: |
 *       E.164 formatında telefon numarasına 6 haneli OTP gönderir. SMS sağlayıcı
 *       `SMS_PROVIDER` ortam değişkeni ile belirlenir (mock, netgsm).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone]
 *             properties:
 *               phone:
 *                 type: string
 *                 example: '+905321234567'
 *     responses:
 *       200:
 *         description: OTP gönderildi
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sessionId: { type: string, format: uuid }
 *                 expiresIn: { type: integer, example: 300 }
 *                 cooldownSec: { type: integer, example: 30 }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */
router.post(
  '/send-otp',
  sendOtpLimiter,
  validate({ body: schemas.sendOtpSchema }),
  asyncHandler(controller.sendOtp),
);

/**
 * @openapi
 * /auth/phone/verify-otp:
 *   post:
 *     tags: [Auth - Phone]
 *     summary: OTP'yi doğrula
 *     description: |
 *       Mevcut kullanıcı: access + refresh token döner.
 *       Yeni kullanıcı: kayıt formu için kısa süreli `registrationToken` döner.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, code]
 *             properties:
 *               sessionId: { type: string, format: uuid }
 *               code: { type: string, example: '123456' }
 *     responses:
 *       200:
 *         description: Doğrulama başarılı
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   properties:
 *                     ok: { type: boolean }
 *                     isExisting: { type: boolean, example: true }
 *                     accessToken: { type: string }
 *                     refreshToken: { type: string }
 *                     expiresIn: { type: integer }
 *                     user: { $ref: '#/components/schemas/UserPublic' }
 *                 - type: object
 *                   properties:
 *                     ok: { type: boolean }
 *                     isExisting: { type: boolean, example: false }
 *                     registrationToken: { type: string }
 *                     expiresIn: { type: integer }
 *       401:
 *         description: Kod hatalı
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/verify-otp',
  verifyLimiter,
  validate({ body: schemas.verifyOtpSchema }),
  asyncHandler(controller.verifyOtp),
);

/**
 * @openapi
 * /auth/phone/resend-otp:
 *   post:
 *     tags: [Auth - Phone]
 *     summary: OTP'yi yeniden gönder (cooldown sonrası)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId]
 *             properties:
 *               sessionId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Yeni OTP gönderildi
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 cooldownSec: { type: integer }
 *                 expiresIn: { type: integer }
 *       404: { description: 'Session yok' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */
router.post(
  '/resend-otp',
  validate({ body: schemas.resendOtpSchema }),
  asyncHandler(controller.resendOtp),
);

module.exports = router;
