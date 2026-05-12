'use strict';

const { Router } = require('express');
const Joi = require('joi');

const validate = require('../../middlewares/validate');
const asyncHandler = require('../../shared/async-handler');
const controller = require('./token.controller');

const router = Router();

const refreshSchema = Joi.object({ refreshToken: Joi.string().required() });

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

module.exports = router;
