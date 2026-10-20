'use strict';

const { Router } = require('express');
const Joi = require('joi');
const asyncHandler = require('../../../shared/async-handler');
const validate = require('../../../middlewares/validate');
const { requireSuperAdmin } = require('../../../middlewares/auth');
const service = require('./panelUsers.service');

const router = Router();

router.use(requireSuperAdmin);

const idParams = Joi.object({ id: Joi.string().max(36).required() });
const listQuery = Joi.object({
  status: Joi.string().valid('pending', 'active', 'rejected', 'disabled').optional(),
  q: Joi.string().trim().max(100).allow('').optional(),
});
const rejectSchema = Joi.object({ reason: Joi.string().trim().max(500).allow('', null).optional() });
const roleSchema = Joi.object({ role: Joi.string().valid('admin', 'super_admin').required() });
const statusSchema = Joi.object({ status: Joi.string().valid('active', 'disabled').required() });

const actor = (req) => ({ id: req.panelUser.id, role: req.panelUser.role });

/**
 * @openapi
 * /admin/panel-users:
 *   get:
 *     tags: [Admin - Panel Kullanıcıları]
 *     summary: Panel kullanıcıları ve hesap talepleri (yalnız süper admin)
 *     description: 'status ile süzülür (pending = bekleyen talepler); q ad/e-postada arar. Sayfalama yok.'
 *     security: [ { panelBearer: [] } ]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [pending, active, rejected, disabled] } }
 *       - { in: query, name: q, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Liste
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items: { type: array, items: { $ref: '#/components/schemas/PanelUser' } }
 *                 total: { type: integer }
 *       403: { description: 'super_admin_required | password_change_required | forbidden' }
 */
router.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    res.json(await service.listUsers(req.query));
  }),
);

/**
 * @openapi
 * /admin/panel-users/{id}:
 *   get:
 *     tags: [Admin - Panel Kullanıcıları]
 *     summary: Panel kullanıcısı / talep detayı
 *     security: [ { panelBearer: [] } ]
 *     parameters: [ { in: path, name: id, required: true, schema: { type: string } } ]
 *     responses:
 *       200: { content: { application/json: { schema: { $ref: '#/components/schemas/PanelUser' } } } }
 *       404: { description: 'panel_user_not_found' }
 */
router.get(
  '/:id',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    res.json(await service.getUser(req.params.id));
  }),
);

/**
 * @openapi
 * /admin/panel-users/{id}/audit:
 *   get:
 *     tags: [Admin - Panel Kullanıcıları]
 *     summary: Hesap geçmişi (son 100 işlem, yeniden eskiye)
 *     security: [ { panelBearer: [] } ]
 *     parameters: [ { in: path, name: id, required: true, schema: { type: string } } ]
 *     responses:
 *       200:
 *         description: 'items: { id, action, actor: { id, name } | null, detail, at }'
 *       404: { description: 'panel_user_not_found' }
 */
router.get(
  '/:id/audit',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    res.json(await service.listAudit(req.params.id));
  }),
);

/**
 * @openapi
 * /admin/panel-users/{id}/approve:
 *   post:
 *     tags: [Admin - Panel Kullanıcıları]
 *     summary: Bekleyen hesap talebini onayla (rol admin olarak açılır)
 *     security: [ { panelBearer: [] } ]
 *     parameters: [ { in: path, name: id, required: true, schema: { type: string } } ]
 *     responses:
 *       200: { content: { application/json: { schema: { $ref: '#/components/schemas/PanelUser' } } } }
 *       404: { description: 'panel_user_not_found' }
 *       409: { description: 'invalid_state (talep bekleyen durumda değil)' }
 */
router.post(
  '/:id/approve',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    res.json(await service.approve(actor(req), req.params.id));
  }),
);

/**
 * @openapi
 * /admin/panel-users/{id}/reject:
 *   post:
 *     tags: [Admin - Panel Kullanıcıları]
 *     summary: Bekleyen hesap talebini reddet (gerekçe isteğe bağlı, girişte kişiye gösterilir)
 *     security: [ { panelBearer: [] } ]
 *     parameters: [ { in: path, name: id, required: true, schema: { type: string } } ]
 *     requestBody:
 *       content: { application/json: { schema: { type: object, properties: { reason: { type: string, maxLength: 500 } } } } }
 *     responses:
 *       200: { content: { application/json: { schema: { $ref: '#/components/schemas/PanelUser' } } } }
 *       409: { description: 'invalid_state' }
 */
router.post(
  '/:id/reject',
  validate({ params: idParams, body: rejectSchema }),
  asyncHandler(async (req, res) => {
    res.json(await service.reject(actor(req), req.params.id, req.body.reason));
  }),
);

/**
 * @openapi
 * /admin/panel-users/{id}/role:
 *   put:
 *     tags: [Admin - Panel Kullanıcıları]
 *     summary: Rol değiştir (admin ↔ super_admin)
 *     security: [ { panelBearer: [] } ]
 *     parameters: [ { in: path, name: id, required: true, schema: { type: string } } ]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object, required: [role], properties: { role: { type: string, enum: [admin, super_admin] } } } } }
 *     responses:
 *       200: { content: { application/json: { schema: { $ref: '#/components/schemas/PanelUser' } } } }
 *       403: { description: 'cannot_change_own_role' }
 *       409: { description: 'last_super_admin' }
 */
router.put(
  '/:id/role',
  validate({ params: idParams, body: roleSchema }),
  asyncHandler(async (req, res) => {
    res.json(await service.setRole(actor(req), req.params.id, req.body.role));
  }),
);

/**
 * @openapi
 * /admin/panel-users/{id}/status:
 *   put:
 *     tags: [Admin - Panel Kullanıcıları]
 *     summary: Hesabı pasifleştir / yeniden etkinleştir (pasifleştirme oturumları kapatır)
 *     security: [ { panelBearer: [] } ]
 *     parameters: [ { in: path, name: id, required: true, schema: { type: string } } ]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object, required: [status], properties: { status: { type: string, enum: [active, disabled] } } } } }
 *     responses:
 *       200: { content: { application/json: { schema: { $ref: '#/components/schemas/PanelUser' } } } }
 *       403: { description: 'cannot_change_own_status' }
 *       409: { description: 'last_super_admin | invalid_state (active yalnız disabled hesaptan)' }
 */
router.put(
  '/:id/status',
  validate({ params: idParams, body: statusSchema }),
  asyncHandler(async (req, res) => {
    res.json(await service.setStatus(actor(req), req.params.id, req.body.status));
  }),
);

/**
 * @openapi
 * /admin/panel-users/{id}/reset-password:
 *   post:
 *     tags: [Admin - Panel Kullanıcıları]
 *     summary: Geçici şifre üret (ilk girişte değiştirme zorunlu, oturumlar kapanır)
 *     description: 'Geçici şifre yalnız bu yanıtta döner, hiçbir yerde saklanmaz.'
 *     security: [ { panelBearer: [] } ]
 *     parameters: [ { in: path, name: id, required: true, schema: { type: string } } ]
 *     responses:
 *       200:
 *         content: { application/json: { schema: { type: object, properties: { temporaryPassword: { type: string } } } } }
 *       403: { description: 'cannot_reset_own_password' }
 *       409: { description: 'invalid_state (onaylanmamış hesap)' }
 */
router.post(
  '/:id/reset-password',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await service.resetPassword(actor(req), req.params.id));
  }),
);

module.exports = router;
