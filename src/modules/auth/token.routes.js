'use strict';

const { Router } = require('express');
const Joi = require('joi');

const validate = require('../../middlewares/validate');
const asyncHandler = require('../../shared/async-handler');
const controller = require('./token.controller');

const router = Router();

const refreshSchema = Joi.object({ refreshToken: Joi.string().required() });
const restoreSchema = Joi.object({ restoreToken: Joi.string().required() });

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Auth - Token]
 *     summary: Access token'ı yenile (refresh rotation)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200:
 *         description: Yeni token çifti
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthTokenPair' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post(
  '/refresh',
  validate({ body: refreshSchema }),
  asyncHandler(controller.refresh),
);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Auth - Token]
 *     summary: Logout — refresh token'ı iptal et
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       204: { description: 'Logout başarılı' }
 */
router.post(
  '/logout',
  validate({ body: refreshSchema }),
  asyncHandler(controller.logout),
);

/**
 * @openapi
 * /auth/restore:
 *   post:
 *     tags: [Auth - Token]
 *     summary: Silme talebini iptal et ve giriş yap (K28)
 *     description: |
 *       SMS doğrulaması silinme sürecindeki (30 günü dolmamış) bir hesaba aitse verify-otp
 *       `pendingDeletion: true` ve 10 dakikalık `restoreToken` döner. Mobil kişiye "Giriş yaparsanız
 *       silme talebi iptal olur" diye sorar; "Devam" derse bu uç hesabı yeniden açar ve normal girişteki
 *       gibi token çifti döner. "Vazgeç" derse hiçbir şey çağrılmaz, silme süreci sürer.
 *       Token bir kez kullanılır; hesap token'dan sonra yeniden silindiyse işe yaramaz.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [restoreToken]
 *             properties:
 *               restoreToken: { type: string }
 *     responses:
 *       200:
 *         description: Hesap yeniden açıldı; verify-otp'deki mevcut kullanıcı yanıtıyla aynı biçim
 *       401: { description: 'restore_invalid — token geçersiz, süresi dolmuş, kullanılmış ya da hesap artık silinme sürecinde değil' }
 *       503: { description: 'restore_unavailable — erişim engeli kaldırılamadı; hesap değişmedi, tekrar denenebilir' }
 */
router.post(
  '/restore',
  validate({ body: restoreSchema }),
  asyncHandler(controller.restore),
);

module.exports = router;
