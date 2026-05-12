'use strict';

const { Router } = require('express');
const asyncHandler = require('../../shared/async-handler');
const { requireAuth } = require('../../middlewares/auth');
const { errors } = require('../../shared/errors');

const router = Router();

// Placeholder in-memory data — DB tabloları eklenince genişler.
const TRAININGS = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    title: 'İlkyardım Eğitimi',
    description: 'Doğa koşullarında temel müdahale yöntemleri',
    durationMin: 120,
    contentUrl: null,
    videoUrls: [],
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    title: 'Yangın Söndürme Temelleri',
    description: 'Orman yangınlarında ekipman kullanımı ve güvenlik',
    durationMin: 90,
    contentUrl: null,
    videoUrls: [],
  },
];

// Kullanıcı durum kayıtları (gerçek DB'ye geçilecek)
const USER_PROGRESS = new Map(); // userId -> Map<trainingId, status>

router.use(requireAuth);

function statusFor(userId, trainingId) {
  return USER_PROGRESS.get(userId)?.get(trainingId) || 'not_started';
}

function setStatus(userId, trainingId, status) {
  if (!USER_PROGRESS.has(userId)) USER_PROGRESS.set(userId, new Map());
  USER_PROGRESS.get(userId).set(trainingId, status);
}

/**
 * @openapi
 * /trainings:
 *   get:
 *     tags: [Trainings]
 *     summary: Kullanıcıya açık eğitim listesi
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200:
 *         description: Eğitim listesi
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Training' }
 */
router.get('/', asyncHandler(async (req, res) => {
  const items = TRAININGS.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    durationMin: t.durationMin,
    status: statusFor(req.user.id, t.id),
  }));
  res.status(200).json({ items });
}));

/**
 * @openapi
 * /trainings/{id}:
 *   get:
 *     tags: [Trainings]
 *     summary: Eğitim detayı (içerik, video URL'leri)
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Eğitim detayı
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const t = TRAININGS.find((x) => x.id === req.params.id);
  if (!t) throw errors.notFound('Eğitim bulunamadı');
  res.status(200).json({
    ...t,
    status: statusFor(req.user.id, t.id),
  });
}));

/**
 * @openapi
 * /trainings/{id}/start:
 *   post:
 *     tags: [Trainings]
 *     summary: Eğitime başla (status → in_progress)
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Başlatıldı
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post('/:id/start', asyncHandler(async (req, res) => {
  const t = TRAININGS.find((x) => x.id === req.params.id);
  if (!t) throw errors.notFound('Eğitim bulunamadı');
  setStatus(req.user.id, t.id, 'in_progress');
  res.status(200).json({ id: t.id, status: 'in_progress' });
}));

/**
 * @openapi
 * /trainings/{id}/complete:
 *   post:
 *     tags: [Trainings]
 *     summary: Eğitimi tamamla (status → completed)
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Tamamlandı
 */
router.post('/:id/complete', asyncHandler(async (req, res) => {
  const t = TRAININGS.find((x) => x.id === req.params.id);
  if (!t) throw errors.notFound('Eğitim bulunamadı');
  setStatus(req.user.id, t.id, 'completed');
  res.status(200).json({ id: t.id, status: 'completed' });
}));

module.exports = router;
