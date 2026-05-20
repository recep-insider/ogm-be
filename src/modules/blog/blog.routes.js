'use strict';

const { Router } = require('express');
const asyncHandler = require('../../shared/async-handler');
const { requireAuth } = require('../../middlewares/auth');
const service = require('./blog.service');

const router = Router();

router.use(requireAuth);

/**
 * @openapi
 * /blog/posts:
 *   get:
 *     tags: [Blog]
 *     summary: Blog yazıları
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200:
 *         description: Yazı listesi
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/BlogPost' }
 */
router.get('/posts', asyncHandler(async (_req, res) => {
  res.status(200).json(await service.list());
}));

/**
 * @openapi
 * /blog/posts/{id}:
 *   get:
 *     tags: [Blog]
 *     summary: Blog yazısı detayı
 *     security: [ { bearerAuth: [] } ]
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
