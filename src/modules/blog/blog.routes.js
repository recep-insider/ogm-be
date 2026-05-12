'use strict';

const { Router } = require('express');
const Joi = require('joi');
const asyncHandler = require('../../shared/async-handler');
const validate = require('../../middlewares/validate');
const { errors } = require('../../shared/errors');

const router = Router();

// Placeholder in-memory data
const POSTS = [
  {
    slug: 'gonullu-tecnizatlari-dagitiliyor',
    title: 'Yeni Gönüllü Teçhizatları Dağıtılmaya Başlandı',
    excerpt:
      'OGM, yangın gönüllüleri için yeni nesil koruyucu kıyafet ve ekipmanları dağıtmaya başladı.',
    body:
      '... tam içerik buraya gelecek. Bu placeholder veri DB tablosu (`blog_posts`) eklenince ' +
      'tabloya taşınır ve admin panelden yönetilir.',
    imageUrl: null,
    publishedAt: '2026-04-20T08:00:00.000Z',
  },
  {
    slug: 'orman-yanginlari-2026-degerlendirme',
    title: 'Orman Yangınları 2026 — İlk Çeyrek Değerlendirmesi',
    excerpt: '2026 yılının ilk çeyreğinde yaşanan orman yangınlarına dair istatistikler.',
    body: '... tam içerik buraya gelecek.',
    imageUrl: null,
    publishedAt: '2026-04-10T08:00:00.000Z',
  },
];

const listQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(50).default(10),
});

/**
 * @openapi
 * /blog:
 *   get:
 *     tags: [Blog]
 *     summary: Paginated blog post listesi
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 10 }
 *     responses:
 *       200:
 *         description: Blog listesi
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
 *                       slug: { type: string }
 *                       title: { type: string }
 *                       excerpt: { type: string }
 *                       imageUrl: { type: string, format: uri, nullable: true }
 *                       publishedAt: { type: string, format: date-time }
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page: { type: integer }
 *                     pageSize: { type: integer }
 *                     total: { type: integer }
 */
router.get('/', validate({ query: listQuery }), asyncHandler(async (req, res) => {
  const { page, pageSize } = req.query;
  const start = (page - 1) * pageSize;
  const items = POSTS.slice(start, start + pageSize).map((p) => ({
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt,
    imageUrl: p.imageUrl,
    publishedAt: p.publishedAt,
  }));
  res.status(200).json({
    items,
    pagination: { page, pageSize, total: POSTS.length },
  });
}));

/**
 * @openapi
 * /blog/{slug}:
 *   get:
 *     tags: [Blog]
 *     summary: Blog post detayı
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Post detayı
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:slug', asyncHandler(async (req, res) => {
  const post = POSTS.find((p) => p.slug === req.params.slug);
  if (!post) throw errors.notFound('Yazı bulunamadı');
  res.status(200).json(post);
}));

module.exports = router;
