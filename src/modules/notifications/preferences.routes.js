'use strict';

const { Router } = require('express');
const asyncHandler = require('../../shared/async-handler');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const service = require('./preferences.service');
const { updatePreferencesSchema } = require('./preferences.validators');

const router = Router();

router.use(requireAuth);

/**
 * @openapi
 * /users/me/notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: Bildirim tercihleri
 *     description: >-
 *       Dört kategori döner. `acil` sınıfı KAPATILAMAZ (closable:false) ve listenin en
 *       üstünde sabittir — bu bir güvenlik gereksinimidir, tercih değil. Kanal
 *       kategoriden türer: SMS yalnızca `acil`, diğerleri push. Yangın bildirim mesafesi
 *       gönüllünün kendi tercihidir (admin mesafe girmez) ve `baseLocation` noktasından
 *       ölçülür; acil sınıfı bu tercihi bypass eder.
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200:
 *         description: Tercihler
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/NotificationPreferences' }
 *   patch:
 *     tags: [Notifications]
 *     summary: Bildirim tercihlerini güncelle
 *     description: >-
 *       Request `distanceKm` (flat) gönderilir; response `distance:{km,min,max}` (nested)
 *       döner. `acil` kategorisi için anahtar YOKTUR — kapatılamaz.
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               taskCalls: { type: boolean }
 *               trainings: { type: boolean }
 *               announcements: { type: boolean }
 *               distanceKm: { type: integer }
 *               baseLocation:
 *                 type: object
 *                 nullable: true
 *                 description: 'Yarıçapın ölçüleceği nokta; null gönderilirse temizlenir.'
 *                 required: [lat, lng]
 *                 properties:
 *                   lat: { type: number }
 *                   lng: { type: number }
 *                   il: { type: string }
 *                   ilce: { type: string }
 *     responses:
 *       200:
 *         description: Güncellenmiş tercihler
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/NotificationPreferences' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 */
router.get('/', asyncHandler(async (req, res) => {
  res.status(200).json(await service.get(req.user.id));
}));

router.patch('/', validate({ body: updatePreferencesSchema }), asyncHandler(async (req, res) => {
  res.status(200).json(await service.update(req.user.id, req.body));
}));

module.exports = router;
