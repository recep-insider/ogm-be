'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { rateLimitHandler } = require('../../middlewares/rate-limit');
const asyncHandler = require('../../shared/async-handler');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const { avatarUpload } = require('../../middlewares/upload');
const controller = require('./users.controller');
const readinessService = require('./readiness.service');
const {
  patchMeSchema,
  acilSchema,
  consentSchema,
  phoneChangeInitSchema,
  phoneChangeCommitSchema,
} = require('./users.validators');

const router = Router();

router.use(requireAuth);

// /auth/phone OTP uçlarındaki limitlerin karşılığı; oturumlu uç olduğu için kullanıcı başına.
const phoneChangeInitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => req.user.id,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler('Telefon değiştirme OTP isteği limiti aşıldı'),
});

const phoneChangeCommitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  keyGenerator: (req) => req.user.id,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler('OTP doğrulama limiti aşıldı'),
});

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
 *       Tüm alanlar opsiyonel (partial update). Telefon bu uçla değişmez: yalnız OTP doğrulamalı
 *       `POST /users/me/phone-change/init` + `/commit` akışıyla. `phone` mevcut numarayla aynıysa yok
 *       sayılır (eski istemciler formdaki numarayı gönderiyor), farklıysa 400 `use_phone_change`.
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               phone: { type: string, example: '+905557654321', description: 'Yalnız mevcut numara kabul edilir (yok sayılır); değişim için /users/me/phone-change' }
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
 *       400: { description: 'validation_error | use_phone_change (telefon bu uçla değişmez)' }
 *       409: { description: email_taken }
 *   delete:
 *     tags: [Users]
 *     summary: Hesabı sil (KVKK silme talebi)
 *     description: |
 *       Hesap soft-delete yapılır, refresh token'lar iptal edilir, cihaz kayıtları silinir.
 *       Kişisel veriler 30 gün sonra anonimleştirilir/silinir.
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
 *     description: >-
 *       version, kişiye gösterilen metnin GET /legal/{belge} yanıtındaki version alanıdır
 *       (kvkk → kvkk, aydinlatma → aydinlatma-metni, acik_riza → acik-riza). Yayımlanan sürümle
 *       eşleşmezse 400 consent_version_mismatch döner, kayıt yazılmaz (BUG-041). Geçiş dönemi: yayındaki
 *       mobilin sabit gönderdiği 'v1' sürümü /legal'dan okuyan mobil zorunlu olana kadar kabul edilir.
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
 *                 example: 'v1.0'
 *     responses:
 *       201:
 *         description: Onay kaydedildi
 *       400:
 *         description: 'consent_version_mismatch — details.expectedVersion yayımlanan sürüm'
 */
router.post('/me/consents', validate({ body: consentSchema }), asyncHandler(controller.recordConsent));

/**
 * @openapi
 * /users/me/data-export:
 *   get:
 *     tags: [Users]
 *     summary: Tüm kullanıcı verilerini JSON olarak indir (KVKK Madde 11)
 *     description: |
 *       Kullanıcı kendi user kaydı, başvuruları, onayları, cihaz kayıtları, yangın
 *       bildirimleri, SOS çağrıları, acil bildirimleri, görev katılımları, check-in'leri ve
 *       saha eğitimi başvurularını içeren bir JSON dosya indirir. K22 ile eklenen bölümler
 *       okunur (camelCase) alan adlarıyla gelir.
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
 *                 sosCalls:
 *                   type: array
 *                   items: { type: object, properties: { id: { type: string }, status: { type: string }, createdAt: { type: string, format: date-time }, respondedAt: { type: string, nullable: true }, latitude: { type: number, nullable: true }, longitude: { type: number, nullable: true }, il: { type: string, nullable: true }, ilce: { type: string, nullable: true }, message: { type: string, nullable: true } } }
 *                 emergencyReports:
 *                   type: array
 *                   items: { type: object, properties: { id: { type: string }, missionId: { type: string, nullable: true }, createdAt: { type: string }, latitude: { type: number, nullable: true }, longitude: { type: number, nullable: true }, message: { type: string, nullable: true } } }
 *                 missionParticipation:
 *                   type: array
 *                   items: { type: object, properties: { missionId: { type: string }, refNo: { type: string, nullable: true }, missionTitle: { type: string, nullable: true }, status: { type: string }, calledAt: { type: string, nullable: true }, respondedAt: { type: string, nullable: true }, joinedAt: { type: string, nullable: true } } }
 *                 checkIns:
 *                   type: array
 *                   items: { type: object, properties: { missionId: { type: string }, checkedInAt: { type: string }, method: { type: string, enum: [qr, tc_manual] } } }
 *                 sahaTrainingApplications:
 *                   type: array
 *                   items: { type: object, properties: { trainingId: { type: string }, trainingTitle: { type: string, nullable: true }, status: { type: string }, attendance: { type: string, nullable: true }, appliedAt: { type: string, nullable: true } } }
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
 *       429:
 *         description: >-
 *           `rate_limited` — kullanıcı başına saatte 5 istek; `sms_daily_limit` — hedef telefona
 *           günlük OTP SMS limiti (SMS_DAILY_LIMIT_PER_USER) doldu, `details.retryAfterSec` döner.
 *       503:
 *         description: >-
 *           `sms_unavailable` — üretimde SMS sağlayıcı bağlı değil (SMS_PROVIDER=mock); yalnız
 *           OTP_DUMMY_PHONES numaralarına kod gönderilir. Oturum açılmaz.
 */
router.post(
  '/me/phone-change/init',
  phoneChangeInitLimiter,
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
 *       400: { description: 'invalid_otp — kod yanlış (oturum hatası değil; token yenilenmez)' }
 *       410: { description: 'otp_expired — kodun ya da oturumun süresi doldu; yeni kod istenir' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */
router.post(
  '/me/phone-change/commit',
  phoneChangeCommitLimiter,
  validate({ body: phoneChangeCommitSchema }),
  asyncHandler(controller.phoneChangeCommit),
);

/**
 * @openapi
 * /users/me/readiness:
 *   get:
 *     tags: [Users]
 *     summary: Hazırlık zinciri — gönüllü nerede takıldı (türetilmiş)
 *     description: >-
 *       mobil-gereksinimleri.md §8/§10: Başvuru → Komisyon onayı → Teorik eğitim →
 *       Uygulamalı (saha) eğitimi → KKD → Hazır. Adımlar birbirinin yerine geçmez, sıra
 *       atlanamaz. Eksiği olan gönüllü hiçbir göreve katılamaz; engeller burada listelenir.
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200:
 *         description: Hazırlık zinciri, kişi durumu, müdahale yetkisi ve engeller
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Readiness' }
 */
router.get('/me/readiness', asyncHandler(async (req, res) => {
  res.status(200).json(await readinessService.getReadiness(req.user.id));
}));

module.exports = router;
