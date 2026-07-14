'use strict';

const { Router } = require('express');

const validate = require('../../../middlewares/validate');
const asyncHandler = require('../../../shared/async-handler');
const { requireAdminAuth } = require('../../../middlewares/auth');
const controller = require('./adminAuth.controller');
const { loginSchema, refreshSchema } = require('./adminAuth.validators');

const router = Router();

/**
 * @openapi
 * /admin/auth/login:
 *   post:
 *     tags: [Admin - Auth]
 *     summary: Admin/officer girişi (e-posta + şifre)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [eposta, sifre]
 *             properties:
 *               eposta: { type: string, format: email }
 *               sifre: { type: string, format: password }
 *     responses:
 *       200:
 *         description: Access + refresh token çifti ve admin profili
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { description: 'Çok fazla başarısız deneme' }
 */
router.post('/login', validate({ body: loginSchema }), asyncHandler(controller.login));

/**
 * @openapi
 * /admin/auth/refresh:
 *   post:
 *     tags: [Admin - Auth]
 *     summary: Admin access token'ı yenile (refresh rotation)
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
 *       200: { description: 'Yeni token çifti' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post('/refresh', validate({ body: refreshSchema }), asyncHandler(controller.refresh));

/**
 * @openapi
 * /admin/auth/logout:
 *   post:
 *     tags: [Admin - Auth]
 *     summary: Admin logout — refresh token'ı iptal et
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
router.post('/logout', validate({ body: refreshSchema }), asyncHandler(controller.logout));

/**
 * @openapi
 * /admin/auth/me:
 *   get:
 *     tags: [Admin - Auth]
 *     summary: Oturumdaki admin/officer profili
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: 'Admin profili' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/me', requireAdminAuth, asyncHandler(controller.me));

module.exports = router;
