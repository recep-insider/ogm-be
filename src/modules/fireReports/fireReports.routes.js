'use strict';

const { Router } = require('express');
const asyncHandler = require('../../shared/async-handler');
const { optionalAuth } = require('../../middlewares/auth');
const { fireReportUpload } = require('../../middlewares/upload');
const { idempotent } = require('../../middlewares/idempotency');
const controller = require('./fireReports.controller');

const router = Router();

/**
 * @openapi
 * /fire-reports:
 *   post:
 *     tags: [Fire Reports]
 *     summary: Yangın ihbarı (multipart, media[] min 1) — guest (token'sız) da gönderebilir
 *     security: [ {}, { bearerAuth: [] } ]
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         schema: { type: string, maxLength: 200 }
 *         description: Aynı anahtar ve gövdeyle tekrar gelen istek yeniden işlenmez; ilk başarılı yanıt `Idempotent-Replayed: true` ile döner (ayrıntı POST /admin/missions).
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [data, media]
 *             properties:
 *               data:
 *                 type: string
 *                 description: 'JSON: { coordinates, needs[], description }'
 *               media:
 *                 type: array
 *                 description: 'Görsel ≤ maxDocBytes (10MB), video ≤ maxVideoBytes (100MB)'
 *                 items: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Bildirim alındı
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *                 report: { $ref: '#/components/schemas/FireReportSummary' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       409: { description: 'idempotency_in_flight — aynı anahtarlı ilk istek sürüyor' }
 *       422: { description: 'idempotency_key_reused — anahtar farklı bir gövdeyle kullanılmış' }
 *       413: { $ref: '#/components/responses/PayloadTooLarge' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */
// Yangın ihbarı acil akıştır — token'sız (guest) gönderim kabul edilir; token
// varsa ihbar kullanıcıya bağlanır (üye olmadan devam senaryosu, kontrat 9.1).
// Anahtar multer'dan sonra kontrol edilir: gövde alanları ancak o zaman okunur.
router.post('/', optionalAuth, fireReportUpload, idempotent({ releaseOn5xx: true }), asyncHandler(controller.create));

module.exports = router;
