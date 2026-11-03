'use strict';

const { Router } = require('express');
const asyncHandler = require('../../shared/async-handler');
const { requireAuth } = require('../../middlewares/auth');
const { fireReportUpload } = require('../../middlewares/upload');
const { idempotent } = require('../../middlewares/idempotency');
const controller = require('./fireReports.controller');

const router = Router();

// Token'sız ihbar misafir ihbarıdır; token gönderilip geçersiz ya da süresi dolmuşsa ihbar
// sessizce anonim kaydedilmez, 401 döner ki mobil oturumu yenileyip tekrar göndersin (BUG-027).
function guestOrAuthenticated(req, res, next) {
  if (!req.headers.authorization) return next();
  return requireAuth(req, res, next);
}

/**
 * @openapi
 * /fire-reports:
 *   post:
 *     tags: [Fire Reports]
 *     summary: Yangın ihbarı (multipart, media[] min 1) — guest (token'sız) da gönderebilir
 *     description: Authorization başlığı gönderilir ve token geçersiz ya da süresi dolmuşsa 401 döner, ihbar kaydedilmez (BUG-027); başlık yoksa misafir ihbarıdır.
 *     security: [ {}, { bearerAuth: [] } ]
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         schema: { type: string, maxLength: 200 }
 *         description: 'Aynı anahtar ve gövdeyle tekrar gelen istek yeniden işlenmez; ilk başarılı yanıt `Idempotent-Replayed: true` ile döner (ayrıntı POST /admin/missions).'
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
 *       413: { description: 'file_too_large — tek dosya sınırı (görsel 10 MB, video 100 MB); payload_too_large — ihbar başına toplam 100 MB aşıldı (K9); details.limitBytes' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */
// Yangın ihbarı acil akıştır — token'sız (guest) gönderim kabul edilir; token
// varsa ihbar kullanıcıya bağlanır (üye olmadan devam senaryosu, kontrat 9.1).
// Anahtar multer'dan sonra kontrol edilir: gövde alanları ancak o zaman okunur.
router.post('/', guestOrAuthenticated, fireReportUpload, idempotent({ releaseOn5xx: true }), asyncHandler(controller.create));

module.exports = router;
