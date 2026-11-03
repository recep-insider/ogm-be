'use strict';

const { Router } = require('express');
const Joi = require('joi');
const asyncHandler = require('../../shared/async-handler');
const { optionalAuth } = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const service = require('./blog.service');

const router = Router();

// Blog içeriği public; misafir ve onay-bekleyen kullanıcı da görebilmeli.
// Token varsa req.user dolar, yoksa null — servis req.user kullanmıyor (davranış değişmez).
router.use(optionalAuth);

/**
 * @openapi
 * /blog/posts:
 *   get:
 *     tags: [Blog]
 *     summary: Blog yazıları
 *     security: [ {}, { bearerAuth: [] } ]
 *     parameters:
 *       - { in: query, name: category, schema: { type: string, enum: [haber, teknik, egitim, tumu] } }
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: pageSize, schema: { type: integer, minimum: 1, maximum: 100 }, description: 'Verilmezse tüm liste' }
 *     responses:
 *       200:
 *         description: Yazı listesi
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/BlogPost' }
 *       400: { description: 'validation_error — geçersiz category (dizi dahil), page ya da pageSize' }
 */
// mobil §9: kategori filtresi — Haber · Teknik · Eğitim + "Tümü". pageSize verilmezse tüm liste döner.
const listQuery = Joi.object({
  category: Joi.string().valid('haber', 'teknik', 'egitim', 'tumu'),
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(100),
});

router.get('/posts', validate({ query: listQuery }), asyncHandler(async (req, res) => {
  res.status(200).json(await service.list(req.query));
}));

/**
 * @openapi
 * /blog/posts/{id}:
 *   get:
 *     tags: [Blog]
 *     summary: Blog yazısı detayı
 *     security: [ {}, { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Yazı
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/BlogPost' }
 *       404: { description: 'post_not_found' }
 */
router.get('/posts/:id', asyncHandler(async (req, res) => {
  res.status(200).json(await service.getById(req.params.id));
}));

module.exports = router;
