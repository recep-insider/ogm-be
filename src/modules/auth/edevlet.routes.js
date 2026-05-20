'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');

const validate = require('../../middlewares/validate');
const asyncHandler = require('../../shared/async-handler');
const controller = require('./edevlet.controller');
const schemas = require('./edevlet.validators');

const router = Router();

const initiateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'IP başına e-Devlet başlatma limiti aşıldı' } },
});

/**
 * @openapi
 * /auth/edevlet/initiate:
 *   post:
 *     tags: [Auth - e-Devlet]
 *     summary: e-Devlet OAuth akışını başlat
 *     description: |
 *       Mobil app dönen `redirectUrl`'i in-app browser'da açar. Kullanıcı e-Devlet'te
 *       kimliğini doğrular, custom URL scheme ile app'e döner.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               callbackScheme:
 *                 type: string
 *                 example: 'ogmgonullu'
 *     responses:
 *       200:
 *         description: Akış başlatıldı
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sessionId: { type: string, format: uuid }
 *                 redirectUrl: { type: string, format: uri }
 *                 expiresIn: { type: integer, example: 600 }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */
router.post(
  '/initiate',
  initiateLimiter,
  validate({ body: schemas.initiateSchema }),
  asyncHandler(controller.initiate),
);

/**
 * @openapi
 * /auth/edevlet/callback:
 *   post:
 *     tags: [Auth - e-Devlet]
 *     summary: e-Devlet'ten dönen code'u işle
 *     description: |
 *       Mevcut kullanıcı: erişim+yenileme token'ları döner.
 *       Yeni kullanıcı: 4 adımlı kayıt formu için kısa süreli token döner; `isExisting=false`.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, code]
 *             properties:
 *               sessionId: { type: string, format: uuid }
 *               code: { type: string }
 *               state: { type: string }
 *     responses:
 *       200:
 *         description: Doğrulama başarılı
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken: { type: string }
 *                 refreshToken: { type: string, nullable: true }
 *                 expiresIn: { type: integer }
 *                 isExisting: { type: boolean }
 *                 user: { $ref: '#/components/schemas/UserPublic' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post(
  '/callback',
  validate({ body: schemas.callbackSchema }),
  asyncHandler(controller.callback),
);

/**
 * @openapi
 * /auth/edevlet/mock:
 *   get:
 *     tags: [Auth - e-Devlet]
 *     summary: '[DEV] Mock e-Devlet onay sayfası'
 *     description: '`EDEVLET_MOCK_MODE=true` iken aktif. Production''da 404 döner.'
 *     parameters:
 *       - in: query
 *         name: sessionId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: state
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Mock kimlik bilgileri
 */
router.get('/mock', asyncHandler(controller.mockCallback));

module.exports = router;
