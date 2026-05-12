'use strict';

const { Router } = require('express');
const asyncHandler = require('../../shared/async-handler');
const controller = require('./reference.controller');

const router = Router();

/**
 * @openapi
 * /reference/{category}:
 *   get:
 *     tags: [Reference]
 *     summary: Kategori için referans listesini döndürür
 *     parameters:
 *       - in: path
 *         name: category
 *         required: true
 *         schema:
 *           type: string
 *           enum: [kan-grubu, ogrenim, meslek, hobiler, yakinlik, ulkeler]
 *     responses:
 *       200:
 *         description: Liste
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/ReferenceItem' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:category', asyncHandler(controller.get));

module.exports = router;
