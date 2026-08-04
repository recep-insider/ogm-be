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
 *       kabul edilir. Kullanıcının iletişim ve acil durum kişi bilgileri çağrı anında kayda
 *       snapshot'lanır ve operasyon merkezi paneline düşer.
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
 *               message: { type: string, nullable: true, maxLength: 500 }
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

module.exports = router;
