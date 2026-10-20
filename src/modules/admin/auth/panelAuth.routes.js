'use strict';

const { Router } = require('express');
const Joi = require('joi');
const asyncHandler = require('../../../shared/async-handler');
const validate = require('../../../middlewares/validate');
const { requirePanelUser } = require('../../../middlewares/auth');
const env = require('../../../config/env');
const service = require('./panelAuth.service');

const COOKIE_NAME = 'ogm_panel_rt';
const COOKIE_PATH = '/v1/admin/auth';

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    path: COOKIE_PATH,
    secure: env.nodeEnv === 'production',
  };
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function setRefreshCookie(res, token) {
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: service.REFRESH_TTL_SEC * 1000 });
}

function clearRefreshCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

function meta(req) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

function sendSession(res, { refreshToken, ...body }) {
  setRefreshCookie(res, refreshToken);
  res.status(200).json(body);
}

const loginSchema = Joi.object({
  email: Joi.string().trim().max(254).required(),
  password: Joi.string().max(200).required(),
});

const passwordSchema = Joi.object({
  currentPassword: Joi.string().max(200).required(),
  newPassword: Joi.string()
    .min(8)
    .max(72)
    .custom((value, helpers) => (Buffer.byteLength(value, 'utf8') > 72 ? helpers.error('string.max', { limit: 72 }) : value))
    .invalid(Joi.ref('currentPassword'))
    .required()
    .messages({ 'any.invalid': 'Yeni şifre mevcut şifreden farklı olmalı.' }),
});

const router = Router();

/**
 * @openapi
 * /admin/auth/login:
 *   post:
 *     tags: [Admin - Auth]
 *     summary: Panel girişi (e-posta + şifre)
 *     description: >-
 *       Mobil uygulamadan ÇAĞRILMAZ. Başarılı girişte access token gövdede döner, refresh token
 *       `ogm_panel_rt` httpOnly çerezine yazılır (Path=/v1/admin/auth, SameSite=Strict, 12 saat).
 *       Aynı e-posta + IP için 15 dakikada 5 hatalı denemeden sonra 429 döner.
 *       Şifre doğru değilse hesap durumu açıklanmaz (invalid_credentials).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Giriş başarılı
 *         headers:
 *           Set-Cookie: { schema: { type: string }, description: 'ogm_panel_rt refresh çerezi' }
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PanelSession' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { description: 'invalid_credentials' }
 *       403: { description: 'account_pending | account_rejected (details.reason) | account_disabled' }
 *       429: { description: 'rate_limited (details.retryAfterSec)' }
 */
router.post(
  '/login',
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    sendSession(res, await service.login(req.body, meta(req)));
  }),
);

/**
 * @openapi
 * /admin/auth/refresh:
 *   post:
 *     tags: [Admin - Auth]
 *     summary: Panel access token'ını yenile (refresh çerezi, rotasyonlu)
 *     description: >-
 *       Gövde yok; `ogm_panel_rt` çerezi okunur. Her başarılı yenilemede yeni refresh token verilir,
 *       eskisi iptal edilir ve süre 12 saat uzar. Yenilenmiş (devredilmiş) bir token tekrar sunulursa
 *       kullanıcının tüm oturumları kapatılır (refresh_reused); çıkış ya da şifre değişimiyle kapanan token
 *       yalnız refresh_invalid döner. Hata durumunda çerez silinir.
 *     responses:
 *       200:
 *         description: Yeni access token + yenilenmiş çerez
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PanelSession' }
 *       401: { description: 'refresh_invalid | refresh_expired | refresh_reused' }
 *       403: { description: 'account_pending | account_rejected | account_disabled (oturumlar kapatılır)' }
 */
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    try {
      sendSession(res, await service.refresh(readCookie(req, COOKIE_NAME), meta(req)));
    } catch (err) {
      clearRefreshCookie(res);
      throw err;
    }
  }),
);

/**
 * @openapi
 * /admin/auth/logout:
 *   post:
 *     tags: [Admin - Auth]
 *     summary: Panel çıkışı — sunulan refresh token'ı iptal eder, çerezi siler
 *     description: İdempotent; çerez yoksa ya da zaten iptal edilmişse de 204 döner.
 *     responses:
 *       204: { description: Çıkış yapıldı }
 */
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await service.logout(readCookie(req, COOKIE_NAME));
    clearRefreshCookie(res);
    res.status(204).end();
  }),
);

/**
 * @openapi
 * /admin/auth/me:
 *   get:
 *     tags: [Admin - Auth]
 *     summary: Oturumdaki panel kullanıcısı
 *     description: '`mustChangePassword` true iken de çağrılabilir.'
 *     security: [ { panelBearer: [] } ]
 *     responses:
 *       200:
 *         description: Panel kullanıcısı
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *                 name: { type: string }
 *                 email: { type: string }
 *                 role: { type: string, enum: [admin, super_admin] }
 *                 mustChangePassword: { type: boolean }
 *                 unitId: { type: string, nullable: true }
 *                 phone: { type: string, nullable: true }
 *                 lastLoginAt: { type: string, format: date-time, nullable: true }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/me', requirePanelUser, (req, res) => {
  res.status(200).json(service.profile(req.panelUser));
});

/**
 * @openapi
 * /admin/auth/password:
 *   put:
 *     tags: [Admin - Auth]
 *     summary: Şifre değiştir
 *     description: >-
 *       `mustChangePassword` true iken mevcut şifre geçici şifredir. Başarılı değişiklikte zorunluluk
 *       kalkar ve bu oturum dışındaki tüm oturumlar kapatılır.
 *     security: [ { panelBearer: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string }
 *               newPassword: { type: string, minLength: 8, maxLength: 72, description: 'Mevcut şifreden farklı olmalı' }
 *     responses:
 *       204: { description: Şifre değişti }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { description: 'invalid_credentials (mevcut şifre hatalı) | unauthorized (token)' }
 */
router.put(
  '/password',
  requirePanelUser,
  validate({ body: passwordSchema }),
  asyncHandler(async (req, res) => {
    await service.changePassword(req.panelUser, req.body, readCookie(req, COOKIE_NAME));
    res.status(204).end();
  }),
);

module.exports = router;
