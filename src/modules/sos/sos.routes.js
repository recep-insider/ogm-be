'use strict';

const { Router } = require('express');
const asyncHandler = require('../../shared/async-handler');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const service = require('./sos.service');
const { sosSchema } = require('./sos.validators');

const router = Router();

/**
 * @openapi
 * /sos:
 *   post:
 *     tags: [Emergency]
 *     summary: SOS — kişisel acil yardım çağrısı (görev bağlamı yok)
 *     description: >
 *       Ana sayfadaki SOS butonundan tetiklenir. /emergency'den farklı olarak görev (mission)
 *       bağlamı yoktur. Konum izni yoksa coordinates alanı hiç gönderilmez; konumsuz çağrı da
 *       kabul edilir. Sebep alanı YOKTUR (backend §12). Çağrı `active` durumunda açılır ve
 *       geçmişine "SOS çağrısı gönderildi" satırı düşer.
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               coordinates:
 *                 type: object
 *                 nullable: true
 *                 properties:
 *                   lat: { type: number }
 *                   lng: { type: number }
 *     responses:
 *       200:
 *         description: SOS çağrısı alındı
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean, example: true }
 *                 sosId: { type: string }
 *                 status: { type: string, enum: [active, responded, cancelled] }
 *                 createdAt: { type: string, format: date-time }
 *                 dispatchedTo: { type: string, example: 'OGM Yangın Harekat Merkezi' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */
router.post('/', requireAuth, validate({ body: sosSchema }), asyncHandler(async (req, res) => {
  const result = await service.create({
    userId: req.user.id,
    body: req.body,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  res.status(200).json(result);
}));

/**
 * @openapi
 * /sos/active:
 *   get:
 *     tags: [Emergency]
 *     summary: Açık SOS çağrım — canlı durum ve geçmiş
 *     description: >-
 *       mobil §4: ekran statik bir onay değil, canlı durumdur (Gönderildi → Merkez seni
 *       arıyor → Müdahale edildi / İptal edildi). Aradaki adımlar ayrı bir durum değil,
 *       çağrının geçmişindeki satırlardır. Ana ekran widget'ı da bu sözleşmeyi okur.
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200: { description: 'Açık çağrı ({sosId,status,history[]}) veya null' }
 */
router.get('/active', requireAuth, asyncHandler(async (req, res) => {
  res.status(200).json(await service.getActiveForUser(req.user.id));
}));

/**
 * @openapi
 * /sos/{id}:
 *   get:
 *     tags: [Emergency]
 *     summary: SOS çağrısının durumu ve geçmişi
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: '{sosId,status,createdAt,coordinates,history[]}' }
 *       404: { description: sos_not_found }
 */
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  res.status(200).json(await service.getForUser(req.params.id, req.user.id));
}));

/**
 * @openapi
 * /sos/{id}/cancel:
 *   post:
 *     tags: [Emergency]
 *     summary: SOS'u iptal et (yalnızca gönüllü)
 *     description: >-
 *       backend §10: `cancelled` sinyalinin sahibi gönüllüdür — operatör panelden
 *       iptal EDEMEZ, yalnızca görüntüler (yolda/katılamıyor ile aynı ilke).
 *       Yalnızca `active` çağrı iptal edilebilir.
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: '{ok, sosId, status: cancelled, cancelledAt}' }
 *       403: { description: 'Çağrı başkasına ait' }
 *       404: { description: sos_not_found }
 *       409: { description: sos_not_active }
 */
router.post('/:id/cancel', requireAuth, asyncHandler(async (req, res) => {
  res.status(200).json(await service.cancel(req.params.id, {
    userId: req.user.id,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  }));
}));

module.exports = router;
