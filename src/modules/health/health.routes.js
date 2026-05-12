'use strict';

const { Router } = require('express');
const controller = require('./health.controller');

const router = Router();

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Liveness probe
 *     description: Servis ayakta mı? Bağımlılıklara dokunmaz.
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: 'ok' }
 *                 uptimeSeconds: { type: integer }
 *                 timestamp: { type: string, format: date-time }
 */
router.get('/', controller.liveness);

/**
 * @openapi
 * /health/live:
 *   get:
 *     tags: [Health]
 *     summary: Liveness probe (alias)
 *     responses:
 *       200: { description: OK }
 */
router.get('/live', controller.liveness);

/**
 * @openapi
 * /health/ready:
 *   get:
 *     tags: [Health]
 *     summary: Readiness probe — MySQL & Redis ping
 *     description: |
 *       MySQL ve Redis bağlantılarına ping atar. Her ikisi de up değilse 503 döner.
 *     responses:
 *       200:
 *         description: Tüm bağımlılıklar up
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: 'ok' }
 *                 checks:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name: { type: string }
 *                       status: { type: string, enum: [up, down] }
 *                       latencyMs: { type: integer }
 *                       error: { type: string, nullable: true }
 *       503:
 *         description: Bağımlılıklar arasında down olan var
 */
router.get('/ready', controller.readiness);

module.exports = router;
