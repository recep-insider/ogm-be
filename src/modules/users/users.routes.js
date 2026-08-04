'use strict';

const { Router } = require('express');
const asyncHandler = require('../../shared/async-handler');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const { avatarUpload } = require('../../middlewares/upload');
const controller = require('./users.controller');
const {
  patchMeSchema,
  acilSchema,
  consentSchema,
  phoneChangeInitSchema,
  phoneChangeCommitSchema,
} = require('./users.validators');

const router = Router();

router.use(requireAuth);

/**
 * @openapi
 * /users/me:
 *   get:
 *     tags: [Users]
 *     summary: Mevcut kullanıcı profilini döndürür
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200:
 *         description: Profil
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/UserProfile' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *   patch:
 *     tags: [Users]
 *     summary: Profil alanlarını kısmen günceller
 *     description: |
 *       Tüm alanlar opsiyonel (partial update). Telefon için OTP doğrulamalı güvenli akış
 *       (`POST /users/me/phone-change/init` + `/commit`) de mevcuttur.
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               phone: { type: string, example: '+905557654321' }
 *               eposta: { type: string, format: email }
 *               avatarUrl: { type: string, format: uri, nullable: true }
 *               adres: { type: string }
 *               kanGrubu: { $ref: '#/components/schemas/KanGrubu' }
 *               ogrenim: { $ref: '#/components/schemas/Ogrenim' }
 *               meslek: { $ref: '#/components/schemas/Meslek' }
 *               meslekDiger: { type: string, nullable: true }
 *               hobiler:
 *                 type: array
 *                 items: { type: string }
 *                 description: 'Her öğe `/v1/reference/hobiler` listesinden olmalı'
 *               giysiBedeni:
 *                 type: string
 *                 enum: [S, M, L, XL, XXL, XXXL]
 *                 nullable: true
 *                 description: 'null gönderilirse temizlenir'
 *               ayakkabiNumarasi:
 *                 type: integer
 *                 minimum: 34
 *                 maximum: 50
 *                 nullable: true
 *                 description: 'null gönderilirse temizlenir'
 *               acil: { $ref: '#/components/schemas/AcilIletisim' }
 *     responses:
 *       200:
 *         description: Güncellenmiş profil
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/UserProfile' }
 *   delete:
 *     tags: [Users]
 *     summary: Hesabı sil (KVKK silme talebi)
 *     description: |
 *       Hesap soft-delete yapılır, refresh token'lar iptal edilir, cihaz kayıtları silinir.
 *       Kişisel veriler 30 gün içinde anonimleştirilir/silinir.
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200:
 *         description: Silme talebi alındı
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *                 deletedAt: { type: string, format: date-time }
 *                 purgeAfterDays: { type: integer, example: 30 }
 *                 note: { type: string }
 */
router.get('/me', asyncHandler(controller.getMe));
router.patch('/me', validate({ body: patchMeSchema }), asyncHandler(controller.patchMe));
router.delete('/me', asyncHandler(controller.softDelete));

/**
 * @openapi
 * /users/me/acil:
 *   put:
 *     tags: [Users]
 *     summary: Acil iletişim bilgisini tamamen değiştir
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/AcilIletisim' }
 *     responses:
 *       200:
 *         description: Güncellenmiş profil
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/UserProfile' }
 */
router.put('/me/acil', validate({ body: acilSchema }), asyncHandler(controller.updateAcil));

/**
 * @openapi
 * /users/me/avatar:
 *   post:
 *     tags: [Users]
 *     summary: Avatar yükle (JPG/PNG, max 5 MB)
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [avatar]
 *             properties:
 *               avatar: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Güncellenmiş profil
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/UserProfile' }
 */
router.post('/me/avatar', avatarUpload, asyncHandler(controller.setAvatar));

/**
 * @openapi
 * /users/me/consents:
 *   post:
 *     tags: [Users]
 *     summary: KVKK / aydınlatma / açık rıza onayı kaydet
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [document, version]
 *             properties:
 *               document:
 *                 type: string
 *                 enum: [kvkk, aydinlatma, acik_riza]
 *               version:
 *                 type: string
 *                 example: 'v1'
 *     responses:
 *       201:
 *         description: Onay kaydedildi
 */
router.post('/me/consents', validate({ body: consentSchema }), asyncHandler(controller.recordConsent));

/**
 * @openapi
 * /users/me/data-export:
 *   get:
 *     tags: [Users]
 *     summary: Tüm kullanıcı verilerini JSON olarak indir (KVKK Madde 11)
 *     description: |
 *       Kullanıcı kendi user kaydı, başvuruları, onayları, cihaz kayıtları ve yangın
 *       bildirimlerini içeren bir JSON dosya indirir.
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200:
 *         description: Veri export
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 exportedAt: { type: string, format: date-time }
 *                 legalReference: { type: string, example: 'KVKK Madde 11' }
 *                 user: { type: object, additionalProperties: true }
 *                 applications: { type: array, items: { type: object, additionalProperties: true } }
 *                 consents: { type: array, items: { type: object, additionalProperties: true } }
 *                 devices: { type: array, items: { type: object, additionalProperties: true } }
 *                 fireReports: { type: array, items: { type: object, additionalProperties: true } }
 */
router.get('/me/data-export', asyncHandler(controller.dataExport));

/**
 * @openapi
 * /users/me/phone-change/init:
 *   post:
 *     tags: [Users]
 *     summary: Telefon değiştirme akışı başlat (yeni numaraya OTP gönder)
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone]
 *             properties:
 *               phone: { type: string, example: '+905321234567' }
 *     responses:
 *       200:
 *         description: OTP gönderildi
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sessionId: { type: string, format: uuid }
 *                 expiresIn: { type: integer }
 *                 cooldownSec: { type: integer }
 *       409: { description: 'Telefon zaten başka kullanıcıda kayıtlı' }
 */
router.post(
  '/me/phone-change/init',
  validate({ body: phoneChangeInitSchema }),
  asyncHandler(controller.phoneChangeInit),
);

/**
 * @openapi
 * /users/me/phone-change/commit:
 *   post:
 *     tags: [Users]
 *     summary: Telefon değişimini OTP ile onayla
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, code]
 *             properties:
 *               sessionId: { type: string, format: uuid }
 *               code: { type: string, example: '123456' }
 *     responses:
 *       200:
 *         description: Telefon güncellendi
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *                 phone: { type: string }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post(
  '/me/phone-change/commit',
  validate({ body: phoneChangeCommitSchema }),
  asyncHandler(controller.phoneChangeCommit),
);

module.exports = router;
