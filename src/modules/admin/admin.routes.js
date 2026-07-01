'use strict';

const { Router } = require('express');
const Joi = require('joi');
const asyncHandler = require('../../shared/async-handler');
const validate = require('../../middlewares/validate');
const { requireAdmin } = require('../../middlewares/auth');
const path = require('path');
const env = require('../../config/env');
const { contentUpload } = require('../../middlewares/upload');
const { assetUrl } = require('../../shared/asset-url');
const { errors } = require('../../shared/errors');
const fireReportsController = require('../fireReports/fireReports.controller');
const { adminStatusSchema } = require('../fireReports/fireReports.validators');
const fireReportsService = require('../fireReports/fireReports.service');
const missionsService = require('../missions/missions.service');
const emergencyService = require('../emergency/emergency.service');
const trainingsService = require('../trainings/trainings.service');
const blogService = require('../blog/blog.service');
const adminService = require('./admin.service');

// İşlemi yapan admin'in audit bağlamı (x-api-key'de userId NULL kalır — bilinen kısıt).
function actorFrom(req) {
  return { userId: req.user?.id || null, ip: req.ip, userAgent: req.headers['user-agent'] };
}

const router = Router();

router.use(requireAdmin);

const applicationStatusSchema = Joi.object({
  status: Joi.string().valid(...adminService.APPLICATION_STATUSES).required(),
  note: Joi.string().max(1000).allow('', null).optional(),
});

/**
 * @openapi
 * /admin/users/{userId}/application:
 *   put:
 *     tags: [Admin]
 *     summary: Gönüllü başvuru durumunu güncelle (panel / onay)
 *     description: >-
 *       Mobil uygulamadan ÇAĞRILMAZ. x-api-key (admin) gerektirir.
 *       Kullanıcının en güncel başvurusunun status'unu günceller; bildirim göndermez.
 *     security: [ { adminApiKey: [] } ]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [pending, approved, rejected, requires_revision] }
 *               note: { type: string, nullable: true }
 *     responses:
 *       200:
 *         description: Güncellendi
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 applicationId: { type: string }
 *                 userId: { type: string }
 *                 status: { type: string }
 *                 reviewedAt: { type: string, format: date-time }
 *       404: { description: 'application_not_found' }
 */
router.put(
  '/users/:userId/application',
  validate({ body: applicationStatusSchema }),
  asyncHandler(async (req, res) => {
    const result = await adminService.setApplicationStatus(req.params.userId, req.body, {
      userId: req.user?.id || null,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.status(200).json(result);
  }),
);

/**
 * @openapi
 * /admin/fire-reports/{id}:
 *   put:
 *     tags: [Admin]
 *     summary: Yangın bildirimi statü geçişi (panel)
 *     description: 'Mobil uygulamadan ÇAĞRILMAZ. x-api-key (admin) gerektirir.'
 *     security: [ { adminApiKey: [] } ]
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
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [confirmed, rejected] }
 *               note: { type: string }
 *     responses:
 *       200: { description: Güncellendi }
 */
router.put(
  '/fire-reports/:id',
  validate({ body: adminStatusSchema }),
  asyncHandler(fireReportsController.adminSetStatus),
);

const photoModerationSchema = Joi.object({
  status: Joi.string().valid('approved', 'rejected').required(),
});

/**
 * @openapi
 * /admin/missions/{id}/photos/{submissionId}:
 *   put:
 *     tags: [Admin]
 *     summary: Görev fotoğrafı moderasyonu (panel)
 *     security: [ { adminApiKey: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: submissionId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [approved, rejected] }
 *     responses:
 *       200: { description: Güncellendi }
 */
router.put(
  '/missions/:id/photos/:submissionId',
  validate({ body: photoModerationSchema }),
  asyncHandler(async (req, res) => {
    const result = await missionsService.moderatePhoto(
      req.params.id,
      req.params.submissionId,
      req.body,
      { userId: req.user?.id || null, role: req.actor?.role },
    );
    res.status(200).json(result);
  }),
);

// ── Admin okuma uçları (panel listeleri) ─────────────────────────────────────

const pageQueryKeys = {
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(100).default(20),
};

const volunteersQuerySchema = Joi.object({
  status: Joi.string().valid(...adminService.APPLICATION_STATUSES).optional(),
  q: Joi.string().max(100).optional(),
  ...pageQueryKeys,
});

/**
 * @openapi
 * /admin/volunteers:
 *   get:
 *     tags: [Admin]
 *     summary: Gönüllü listesi (panel)
 *     description: >-
 *       Mobil uygulamadan ÇAĞRILMAZ. x-api-key (admin) gerektirir.
 *       Misafir/silinmiş kullanıcılar hariç; her kullanıcı en güncel başvurusuyla döner.
 *       PII gözetimi: tcKimlik bu listede dönmez (detay ucunda döner).
 *     security: [ { adminApiKey: [] } ]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [pending, approved, rejected, requires_revision] } }
 *       - { in: query, name: q, schema: { type: string }, description: 'ad/soyad/telefon/eposta araması' }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: pageSize, schema: { type: integer, default: 20, maximum: 100 } }
 *     responses:
 *       200:
 *         description: Gönüllü listesi
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       userId: { type: string }
 *                       ad: { type: string }
 *                       soyad: { type: string }
 *                       phone: { type: string }
 *                       eposta: { type: string }
 *                       profileComplete: { type: boolean }
 *                       isActive: { type: boolean }
 *                       applicationStatus: { type: string, nullable: true }
 *                       submittedAt: { type: string, format: date-time, nullable: true }
 *                       egitim: { type: boolean, description: 'En az bir tamamlanmış eğitim' }
 *                       donanim: { type: boolean, description: 'Geçerli koruyucu ekipman' }
 *                 total: { type: integer }
 *                 page: { type: integer }
 *                 pageSize: { type: integer }
 */
router.get(
  '/volunteers',
  validate({ query: volunteersQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await adminService.listVolunteers(req.query));
  }),
);

/**
 * @openapi
 * /admin/volunteers/{userId}:
 *   get:
 *     tags: [Admin]
 *     summary: Gönüllü detayı (panel)
 *     description: 'PII (tcKimlik, adres, acil kişi, belgeler) yalnızca bu uçta döner. x-api-key (admin).'
 *     security: [ { adminApiKey: [] } ]
 *     parameters:
 *       - { in: path, name: userId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: 'user + application (yoksa null)' }
 *       404: { description: 'user_not_found' }
 */
router.get(
  '/volunteers/:userId',
  asyncHandler(async (req, res) => {
    res.json(await adminService.getVolunteer(req.params.userId));
  }),
);

const fireReportsQuerySchema = Joi.object({
  status: Joi.string().valid('reviewing', 'confirmed', 'rejected').optional(),
  ...pageQueryKeys,
});

/**
 * @openapi
 * /admin/fire-reports:
 *   get:
 *     tags: [Admin]
 *     summary: Yangın ihbarı listesi (panel)
 *     description: 'Mobil uygulamadan ÇAĞRILMAZ. x-api-key (admin) gerektirir.'
 *     security: [ { adminApiKey: [] } ]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [reviewing, confirmed, rejected] } }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: pageSize, schema: { type: integer, default: 20, maximum: 100 } }
 *     responses:
 *       200:
 *         description: 'items: ihbar + photoUrls + reporter (anonim değilse), total/page/pageSize'
 */
router.get(
  '/fire-reports',
  validate({ query: fireReportsQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await fireReportsService.adminList(req.query));
  }),
);

/**
 * @openapi
 * /admin/fire-reports/{id}:
 *   get:
 *     tags: [Admin]
 *     summary: Yangın ihbarı detayı (panel)
 *     description: 'Liste alanları + ip. x-api-key (admin).'
 *     security: [ { adminApiKey: [] } ]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: İhbar detayı }
 *       404: { description: not_found }
 */
router.get(
  '/fire-reports/:id',
  asyncHandler(async (req, res) => {
    res.json(await fireReportsService.adminGetById(req.params.id));
  }),
);

const missionsQuerySchema = Joi.object({
  status: Joi.string().valid('active', 'staffed', 'completed').optional(),
  isActive: Joi.boolean().optional(),
  ...pageQueryKeys,
});

/**
 * @openapi
 * /admin/missions:
 *   get:
 *     tags: [Admin]
 *     summary: Görev listesi (panel)
 *     description: 'Tüm görevler (is_active filtresi opsiyonel) + pendingPhotos sayacı. x-api-key (admin).'
 *     security: [ { adminApiKey: [] } ]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [active, staffed, completed] } }
 *       - { in: query, name: isActive, schema: { type: boolean } }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: pageSize, schema: { type: integer, default: 20, maximum: 100 } }
 *     responses:
 *       200: { description: 'items: görev (camelCase, cover URL, pendingPhotos), total/page/pageSize' }
 */
router.get(
  '/missions',
  validate({ query: missionsQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await missionsService.adminList(req.query));
  }),
);

const photosQuerySchema = Joi.object({
  status: Joi.string().valid('pending', 'approved', 'rejected').optional(),
});

/**
 * @openapi
 * /admin/missions/{id}/photos:
 *   get:
 *     tags: [Admin]
 *     summary: Görev fotoğraf/moderasyon kuyruğu (panel)
 *     description: 'status=pending ile bekleyen kuyruk. PUT /admin/missions/{id}/photos/{submissionId} ile moderasyon. x-api-key (admin).'
 *     security: [ { adminApiKey: [] } ]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [pending, approved, rejected] } }
 *     responses:
 *       200: { description: 'mission {id,title} + items[{submissionId,kind,status,url,user}] + total' }
 *       404: { description: mission_not_found }
 */
router.get(
  '/missions/:id/photos',
  validate({ query: photosQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await missionsService.adminListPhotos(req.params.id, req.query));
  }),
);

const trainingsQuerySchema = Joi.object({
  isActive: Joi.boolean().optional(),
});

/**
 * @openapi
 * /admin/trainings/online:
 *   get:
 *     tags: [Admin]
 *     summary: Online eğitim listesi (panel, aggregate)
 *     description: >-
 *       Mobil /trainings/online'dan farklı olarak kullanıcıdan bağımsızdır;
 *       enrolled/completed sayaçları döner. x-api-key (admin) gerektirir.
 *     security: [ { adminApiKey: [] } ]
 *     parameters:
 *       - { in: query, name: isActive, schema: { type: boolean } }
 *     responses:
 *       200: { description: 'items[{id,title,description,durationMin,videoUrl,isActive,enrolled,completed}] + total' }
 */
router.get(
  '/trainings/online',
  validate({ query: trainingsQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await trainingsService.adminListOnline(req.query));
  }),
);

/**
 * @openapi
 * /admin/trainings/saha:
 *   get:
 *     tags: [Admin]
 *     summary: Saha eğitim listesi (panel, aggregate)
 *     description: >-
 *       Başvuru sayaçları (pending/approved/rejected) ve koltuk durumuyla döner.
 *       x-api-key (admin) gerektirir.
 *     security: [ { adminApiKey: [] } ]
 *     parameters:
 *       - { in: query, name: isActive, schema: { type: boolean } }
 *     responses:
 *       200: { description: 'items[{id,title,location,startDate,instructorName,totalSeats,availableSeats,applications{},isActive}] + total' }
 */
router.get(
  '/trainings/saha',
  validate({ query: trainingsQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await trainingsService.adminListSaha(req.query));
  }),
);

const emergencyQuerySchema = Joi.object({
  missionId: Joi.string().max(36).optional(),
  ...pageQueryKeys,
});

/**
 * @openapi
 * /admin/emergency-reports:
 *   get:
 *     tags: [Admin]
 *     summary: Acil durum (SOS) listesi (panel)
 *     description: 'Mobil uygulamadan ÇAĞRILMAZ. x-api-key (admin) gerektirir.'
 *     security: [ { adminApiKey: [] } ]
 *     parameters:
 *       - { in: query, name: missionId, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: pageSize, schema: { type: integer, default: 20, maximum: 100 } }
 *     responses:
 *       200: { description: 'items: SOS + user + mission, total/page/pageSize' }
 */
router.get(
  '/emergency-reports',
  validate({ query: emergencyQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await emergencyService.adminList(req.query));
  }),
);

// ── Dashboard & Raporlar (Ö4) ────────────────────────────────────────────────

/**
 * @openapi
 * /admin/dashboard/summary:
 *   get:
 *     tags: [Admin]
 *     summary: Operasyon Merkezi / sidebar sayaçları (panel)
 *     description: 'Tek istekte tüm özet sayaçlar. x-api-key (admin).'
 *     security: [ { adminApiKey: [] } ]
 *     responses:
 *       200:
 *         description: >-
 *           volunteers{total,pending,approved,rejected,requiresRevision},
 *           fireReports{reviewing,confirmed,rejected,today}, missions{active,staffed,completed},
 *           pendingPhotos, sahaApplications{pending}, emergency{total,today}, blog{published,draft}
 */
router.get(
  '/dashboard/summary',
  asyncHandler(async (_req, res) => {
    res.json(await adminService.dashboardSummary());
  }),
);

const reportsRangeKeys = {
  from: Joi.date().iso().required(),
  to: Joi.date().iso().greater(Joi.ref('from')).required(),
};

/**
 * @openapi
 * /admin/reports/summary:
 *   get:
 *     tags: [Admin]
 *     summary: Raporlar KPI'ları (panel)
 *     description: >-
 *       [from,to) penceresi + bir önceki eşit uzunlukta pencereyle kıyas döner.
 *       "fires" = onaylanmış ihbar sayısı (FIRES domaini netleşene dek vekil metrik);
 *       volunteersTotal = pencere sonu itibarıyla kümülatif; activeVolunteers = pencere içinde
 *       göreve katılan tekil gönüllü; reportAccuracy = confirmed/(confirmed+rejected)%.
 *     security: [ { adminApiKey: [] } ]
 *     parameters:
 *       - { in: query, name: from, required: true, schema: { type: string, format: date } }
 *       - { in: query, name: to, required: true, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: 'range + kpis{fires,volunteersTotal,activeVolunteers,reportAccuracy}{current,previous}' }
 */
router.get(
  '/reports/summary',
  validate({ query: Joi.object(reportsRangeKeys) }),
  asyncHandler(async (req, res) => {
    res.json(await adminService.reportsSummary(req.query));
  }),
);

/**
 * @openapi
 * /admin/reports/series:
 *   get:
 *     tags: [Admin]
 *     summary: Raporlar zaman serisi (panel grafiği)
 *     security: [ { adminApiKey: [] } ]
 *     parameters:
 *       - { in: query, name: metric, required: true, schema: { type: string, enum: [fireReports, confirmedFireReports, emergency, newUsers] } }
 *       - { in: query, name: interval, required: true, schema: { type: string, enum: [day, week, month] } }
 *       - { in: query, name: from, required: true, schema: { type: string, format: date } }
 *       - { in: query, name: to, required: true, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: '{ metric, interval, series: [{bucket, count}] } — boş kovalar dönmez, istemci sıfır doldurur' }
 */
router.get(
  '/reports/series',
  validate({
    query: Joi.object({
      metric: Joi.string().valid(...Object.keys(adminService.SERIES_METRICS)).required(),
      interval: Joi.string().valid(...Object.keys(adminService.SERIES_INTERVALS)).required(),
      ...reportsRangeKeys,
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(await adminService.reportsSeries(req.query));
  }),
);

// ── Admin içerik yazma uçları (Ö3) ───────────────────────────────────────────

const contentBlockSchema = Joi.object({
  type: Joi.string().valid('paragraph', 'heading', 'image', 'video').required(),
  text: Joi.string().allow('').max(5000).optional(),
  source: Joi.string().max(512).optional(),
  caption: Joi.string().allow('').max(300).optional(),
});

const blogBaseKeys = {
  title: Joi.string().max(250),
  description: Joi.string().allow('').max(2000),
  coverPath: Joi.string().allow('', null).max(512),
  publishedAt: Joi.date().iso(),
  readTimeMin: Joi.number().integer().min(1).max(120),
  themes: Joi.array().items(Joi.string().max(60)).max(2),
  authorName: Joi.string().allow('').max(120),
  authorRole: Joi.string().allow('').max(120),
  content: Joi.array().items(contentBlockSchema).max(100),
  isActive: Joi.boolean(),
};

const blogCreateSchema = Joi.object({ ...blogBaseKeys, title: blogBaseKeys.title.required() });
const blogUpdateSchema = Joi.object(blogBaseKeys).min(1);

/**
 * @openapi
 * /admin/content/blog:
 *   get:
 *     tags: [Admin]
 *     summary: Blog yazıları — admin listesi (taslaklar dahil)
 *     description: 'Public /blog/posts''tan farkı: is_active=false kayıtlar da döner; isActive/coverPath/ham content source alanları içerir. x-api-key (admin).'
 *     security: [ { adminApiKey: [] } ]
 *     parameters:
 *       - { in: query, name: isActive, schema: { type: boolean } }
 *     responses:
 *       200: { description: 'items[BlogPost + isActive + coverPath] + total' }
 *   post:
 *     tags: [Admin]
 *     summary: Blog yazısı oluştur
 *     security: [ { adminApiKey: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               coverPath: { type: string, description: 'POST /admin/content/media yanıtındaki path' }
 *               publishedAt: { type: string, format: date }
 *               readTimeMin: { type: integer }
 *               themes: { type: array, items: { type: string }, maxItems: 2 }
 *               authorName: { type: string }
 *               authorRole: { type: string }
 *               content: { type: array, items: { type: object } }
 *               isActive: { type: boolean }
 *     responses:
 *       200: { description: Oluşturulan yazı (admin görünümü) }
 */
router.get(
  '/content/blog',
  validate({ query: Joi.object({ isActive: Joi.boolean().optional() }) }),
  asyncHandler(async (req, res) => {
    res.json(await blogService.adminList(req.query));
  }),
);

router.post(
  '/content/blog',
  validate({ body: blogCreateSchema }),
  asyncHandler(async (req, res) => {
    res.status(200).json(await blogService.adminCreate(req.body, actorFrom(req)));
  }),
);

/**
 * @openapi
 * /admin/content/blog/{id}:
 *   put:
 *     tags: [Admin]
 *     summary: Blog yazısı güncelle (kısmi — isActive:false = yayından kaldır)
 *     security: [ { adminApiKey: [] } ]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Güncellenen yazı }
 *       404: { description: post_not_found }
 *   delete:
 *     tags: [Admin]
 *     summary: Blog yazısını KALICI sil
 *     security: [ { adminApiKey: [] } ]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       204: { description: Silindi }
 *       404: { description: post_not_found }
 */
router.put(
  '/content/blog/:id',
  validate({ body: blogUpdateSchema }),
  asyncHandler(async (req, res) => {
    res.json(await blogService.adminUpdate(req.params.id, req.body, actorFrom(req)));
  }),
);

router.delete(
  '/content/blog/:id',
  asyncHandler(async (req, res) => {
    await blogService.adminRemove(req.params.id, actorFrom(req));
    res.status(204).end();
  }),
);

/**
 * @openapi
 * /admin/content/media:
 *   post:
 *     tags: [Admin]
 *     summary: İçerik medyası yükle (blog görseli/kapak, eğitim videosu)
 *     description: 'multipart/form-data, alan adı `file`. jpeg/png/webp/mp4. Dönen `path` blog/eğitim body''lerinde kullanılır.'
 *     security: [ { adminApiKey: [] } ]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Yüklendi
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 path: { type: string, example: 'content/1718000000-uuid.jpg' }
 *                 url: { type: string }
 *       415: { description: unsupported_media_type }
 */
router.post(
  '/content/media',
  contentUpload,
  asyncHandler(async (req, res) => {
    if (!req.file) throw errors.validation('Dosya zorunludur', { field: 'file' });
    const relPath = path.relative(env.upload.dir, req.file.path);
    res.json({ path: relPath, url: assetUrl(relPath) });
  }),
);

// ── Eğitim yazma uçları ──

const onlineBaseKeys = {
  title: Joi.string().max(200),
  description: Joi.string().allow('').max(2000),
  durationMin: Joi.number().integer().min(0).max(10000),
  iconTone: Joi.string().valid('primary', 'tertiary'),
  sortOrder: Joi.number().integer().min(0),
  videoPath: Joi.string().allow('', null).max(512),
  isActive: Joi.boolean(),
};
const onlineCreateSchema = Joi.object({
  ...onlineBaseKeys,
  title: onlineBaseKeys.title.required(),
  durationMin: onlineBaseKeys.durationMin.required(),
});
const onlineUpdateSchema = Joi.object(onlineBaseKeys).min(1);

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const sahaBaseKeys = {
  title: Joi.string().max(200),
  location: Joi.string().max(200),
  startDate: Joi.date().iso(),
  startTime: Joi.string().pattern(HHMM),
  endTime: Joi.string().pattern(HHMM),
  instructorName: Joi.string().max(120),
  instructorAvatarPath: Joi.string().allow('', null).max(512),
  coverPath: Joi.string().allow('', null).max(512),
  totalSeats: Joi.number().integer().min(0).max(10000),
  isActive: Joi.boolean(),
};
const sahaCreateSchema = Joi.object({
  ...sahaBaseKeys,
  title: sahaBaseKeys.title.required(),
  location: sahaBaseKeys.location.required(),
  startDate: sahaBaseKeys.startDate.required(),
  startTime: sahaBaseKeys.startTime.required(),
  endTime: sahaBaseKeys.endTime.required(),
  instructorName: sahaBaseKeys.instructorName.required(),
});
const sahaUpdateSchema = Joi.object(sahaBaseKeys).min(1);

/**
 * @openapi
 * /admin/trainings/online:
 *   post:
 *     tags: [Admin]
 *     summary: Online eğitim oluştur (panel)
 *     security: [ { adminApiKey: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, durationMin]
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               durationMin: { type: integer }
 *               iconTone: { type: string, enum: [primary, tertiary] }
 *               sortOrder: { type: integer }
 *               videoPath: { type: string, description: 'POST /admin/content/media yanıtındaki path' }
 *               isActive: { type: boolean }
 *     responses:
 *       200: { description: 'Oluşturulan eğitim (admin görünümü, enrolled/completed dahil)' }
 * /admin/trainings/online/{id}:
 *   put:
 *     tags: [Admin]
 *     summary: Online eğitim güncelle (kısmi)
 *     security: [ { adminApiKey: [] } ]
 *     parameters: [ { in: path, name: id, required: true, schema: { type: string } } ]
 *     responses:
 *       200: { description: Güncellenen eğitim }
 *       404: { description: training_not_found }
 *   delete:
 *     tags: [Admin]
 *     summary: Online eğitimi KALICI sil (progress kayıtları CASCADE silinir)
 *     security: [ { adminApiKey: [] } ]
 *     parameters: [ { in: path, name: id, required: true, schema: { type: string } } ]
 *     responses:
 *       204: { description: Silindi }
 *       404: { description: training_not_found }
 */
router.post(
  '/trainings/online',
  validate({ body: onlineCreateSchema }),
  asyncHandler(async (req, res) => {
    res.json(await trainingsService.adminCreateOnline(req.body, actorFrom(req)));
  }),
);
router.put(
  '/trainings/online/:id',
  validate({ body: onlineUpdateSchema }),
  asyncHandler(async (req, res) => {
    res.json(await trainingsService.adminUpdateOnline(req.params.id, req.body, actorFrom(req)));
  }),
);
router.delete(
  '/trainings/online/:id',
  asyncHandler(async (req, res) => {
    await trainingsService.adminRemoveOnline(req.params.id, actorFrom(req));
    res.status(204).end();
  }),
);

/**
 * @openapi
 * /admin/trainings/saha:
 *   post:
 *     tags: [Admin]
 *     summary: Saha eğitimi oluştur (panel)
 *     security: [ { adminApiKey: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, location, startDate, startTime, endTime, instructorName]
 *             properties:
 *               title: { type: string }
 *               location: { type: string }
 *               startDate: { type: string, format: date }
 *               startTime: { type: string, example: '09:00' }
 *               endTime: { type: string, example: '17:00' }
 *               instructorName: { type: string }
 *               instructorAvatarPath: { type: string }
 *               coverPath: { type: string }
 *               totalSeats: { type: integer }
 *               isActive: { type: boolean }
 *     responses:
 *       200: { description: 'Oluşturulan eğitim (admin görünümü, başvuru sayaçlarıyla)' }
 * /admin/trainings/saha/{id}:
 *   put:
 *     tags: [Admin]
 *     summary: Saha eğitimi güncelle (kısmi)
 *     security: [ { adminApiKey: [] } ]
 *     parameters: [ { in: path, name: id, required: true, schema: { type: string } } ]
 *     responses:
 *       200: { description: Güncellenen eğitim }
 *       404: { description: training_not_found }
 *   delete:
 *     tags: [Admin]
 *     summary: Saha eğitimini KALICI sil (başvurular CASCADE silinir)
 *     security: [ { adminApiKey: [] } ]
 *     parameters: [ { in: path, name: id, required: true, schema: { type: string } } ]
 *     responses:
 *       204: { description: Silindi }
 *       404: { description: training_not_found }
 */
router.post(
  '/trainings/saha',
  validate({ body: sahaCreateSchema }),
  asyncHandler(async (req, res) => {
    res.json(await trainingsService.adminCreateSaha(req.body, actorFrom(req)));
  }),
);
router.put(
  '/trainings/saha/:id',
  validate({ body: sahaUpdateSchema }),
  asyncHandler(async (req, res) => {
    res.json(await trainingsService.adminUpdateSaha(req.params.id, req.body, actorFrom(req)));
  }),
);
router.delete(
  '/trainings/saha/:id',
  asyncHandler(async (req, res) => {
    await trainingsService.adminRemoveSaha(req.params.id, actorFrom(req));
    res.status(204).end();
  }),
);

/**
 * @openapi
 * /admin/trainings/saha/{id}/applications:
 *   get:
 *     tags: [Admin]
 *     summary: Saha eğitimi başvuru listesi (panel)
 *     security: [ { adminApiKey: [] } ]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [pending, approved, rejected] } }
 *     responses:
 *       200: { description: 'training {id,title} + items[{applicationId,status,user}] + total' }
 *       404: { description: training_not_found }
 */
router.get(
  '/trainings/saha/:id/applications',
  validate({ query: Joi.object({ status: Joi.string().valid('pending', 'approved', 'rejected').optional() }) }),
  asyncHandler(async (req, res) => {
    res.json(await trainingsService.adminListSahaApplications(req.params.id, req.query));
  }),
);

/**
 * @openapi
 * /admin/trainings/saha/applications/{applicationId}:
 *   put:
 *     tags: [Admin]
 *     summary: Saha eğitimi başvurusu onay/red (panel)
 *     description: 'Bildirim göndermez. x-api-key (admin).'
 *     security: [ { adminApiKey: [] } ]
 *     parameters:
 *       - { in: path, name: applicationId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [pending, approved, rejected] }
 *     responses:
 *       200: { description: '{applicationId, status}' }
 *       404: { description: application_not_found }
 */
router.put(
  '/trainings/saha/applications/:applicationId',
  validate({ body: Joi.object({ status: Joi.string().valid('pending', 'approved', 'rejected').required() }) }),
  asyncHandler(async (req, res) => {
    res.json(await trainingsService.adminSetSahaApplicationStatus(req.params.applicationId, req.body, actorFrom(req)));
  }),
);

module.exports = router;
