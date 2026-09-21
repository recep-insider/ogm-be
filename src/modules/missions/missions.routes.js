'use strict';

const { Router } = require('express');
const asyncHandler = require('../../shared/async-handler');
const validate = require('../../middlewares/validate');
const { requireAuth, requireOfficer } = require('../../middlewares/auth');
const { missionPhotoUpload } = require('../../middlewares/upload');
const controller = require('./missions.controller');
const { scanSchema, respondSchema } = require('./missions.validators');

const router = Router();

/**
 * @openapi
 * /missions/active:
 *   get:
 *     tags: [Missions]
 *     summary: Aktif görev listesi (Anasayfa)
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: lat
 *         schema: { type: number }
 *       - in: query
 *         name: lng
 *         schema: { type: number }
 *     responses:
 *       200:
 *         description: Aktif görevler
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/ActiveMissionSummary' }
 */
router.get('/active', requireAuth, asyncHandler(controller.listActive));

/**
 * @openapi
 * /missions/active/{id}:
 *   get:
 *     tags: [Missions]
 *     summary: Aktif görev detayı
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Görev detayı
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ActiveMissionDetail' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/active/:id', requireAuth, asyncHandler(controller.getActive));

/**
 * @openapi
 * /missions/active/{id}/respond:
 *   post:
 *     tags: [Missions]
 *     summary: Katılım kararı — "Katılmak istiyorum" (yolda) | "Katılamıyorum"
 *     description: >-
 *       backend §3: bu durumların sinyal sahibi GÖNÜLLÜDÜR; operatör panelden
 *       değiştiremez. §5 kuralı istisnasızdır: hazırlık zincirinde eksiği olan gönüllü
 *       hiçbir göreve katılamaz — destek rolüyle katılma seçeneği yoktur. Engel varsa
 *       403 `readiness_incomplete` ve eksik adımlar döner. Uygunluk canlı bir değerdir,
 *       sahaya varışta (check-in) yeniden değerlendirilir.
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [decision]
 *             properties:
 *               decision: { type: string, enum: [yolda, katilamiyor] }
 *     responses:
 *       200:
 *         description: Karar kaydedildi
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *                 userStatus: { type: string, enum: [yolda, katilamiyor] }
 *       403: { description: 'readiness_incomplete — eksik adımlar details.engeller içinde' }
 *       409: { description: 'status_locked — sahada/tamamladı durumu değiştirilemez' }
 */
router.post(
  '/active/:id/respond',
  requireAuth,
  validate({ body: respondSchema }),
  asyncHandler(controller.respond),
);

/**
 * @openapi
 * /missions/active/{id}/scan:
 *   post:
 *     tags: [Missions]
 *     summary: Yangın sahası giriş kaydı — QR check-in (userStatus → sahada)
 *     description: |
 *       Mobil uygulamadan ÇAĞRILMAZ. Saha amiri (officer) `x-api-key` veya
 *       `role=officer` token ile çağırır. Opsiyonel `token` HMAC imzasıdır (B.1).
 *
 *       backend §13: Gönüllü QR'ı `OGM:VOL:{id}` formatındadır; okutulamazsa TC kimlik
 *       numarasıyla manuel kayıt yedek yöntemdir. Hazırlık zincirinde eksik varsa
 *       check-in ENGELLENİR — yalnızca uyarı değil, kayıt oluşmaz ve sahadaki sayıya
 *       girmez. Arama bölge kapsamıyla sınırlı değildir. Sahadaki gönüllü sayısının tek
 *       kaynağı bu kayıttır.
 *     security: [ { officerApiKey: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               qr: { type: string, example: 'OGM:VOL:8f3c...' }
 *               userId: { type: string }
 *               tcKimlik: { type: string, description: 'QR okutulamazsa yedek yöntem' }
 *               scannedAt: { type: string, format: date-time }
 *               token: { type: string, description: 'opsiyonel HMAC imzası' }
 *     responses:
 *       200:
 *         description: 'Giriş kaydedildi — künye (ad, soyad, maskeli TC, kişi/KKD/eğitim durumu, STK) döner'
 *       403: { description: 'readiness_incomplete — katılım engeli, kayıt OLUŞMAZ' }
 *       404: { description: 'volunteer_not_found | mission_not_found' }
 *       409: { description: 'mission_archived' }
 */
router.post('/active/:id/scan', requireOfficer, validate({ body: scanSchema }), asyncHandler(controller.scan));

/**
 * @openapi
 * /missions/active/{id}/photos:
 *   post:
 *     tags: [Missions]
 *     summary: Görev fotoğrafı yükle (yalnızca sahada olan gönüllü)
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Submission alındı
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *                 submissionId: { type: string }
 *                 status: { type: string, example: pending }
 *                 submittedAt: { type: string, format: date-time }
 *       403: { description: 'not_on_site' }
 */
router.post('/active/:id/photos', requireAuth, missionPhotoUpload, asyncHandler(controller.submitPhoto));

module.exports = router;
