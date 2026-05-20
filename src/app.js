'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');

const env = require('./config/env');
const logger = require('./config/logger');
const { buildSpec } = require('./config/swagger');
const { notFoundHandler, errorHandler } = require('./middlewares/error-handler');

const healthRoutes = require('./modules/health/health.routes');
const phoneAuthRoutes = require('./modules/auth/phone.routes');
const edevletAuthRoutes = require('./modules/auth/edevlet.routes');
const tokenRoutes = require('./modules/auth/token.routes');
const onboardingRoutes = require('./modules/onboarding/onboarding.routes');
const referenceRoutes = require('./modules/reference/reference.routes');
const usersRoutes = require('./modules/users/users.routes');
const homeRoutes = require('./modules/home/home.routes');
const notificationsRoutes = require('./modules/notifications/notifications.routes');
const notificationPreferencesRoutes = require('./modules/notifications/preferences.routes');
const legalRoutes = require('./modules/legal/legal.routes');
const trainingsRoutes = require('./modules/trainings/trainings.routes');
const userTrainingsRoutes = require('./modules/trainings/userTrainings.routes');
const blogRoutes = require('./modules/blog/blog.routes');
const missionsRoutes = require('./modules/missions/missions.routes');
const userMissionsRoutes = require('./modules/missions/userMissions.routes');
const equipmentRoutes = require('./modules/equipment/equipment.routes');
const fireReportsRoutes = require('./modules/fireReports/fireReports.routes');
const userFireReportsRoutes = require('./modules/fireReports/userFireReports.routes');
const emergencyRoutes = require('./modules/emergency/emergency.routes');
const adminRoutes = require('./modules/admin/admin.routes');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use((req, _res, next) => {
  logger.debug('İstek alındı', {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
  });
  next();
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'İstek limiti aşıldı' } },
});

app.use('/v1', generalLimiter);

// ─── Health (versioned + root) ────────────────────────────────
app.use('/health', healthRoutes);
app.use('/v1/health', healthRoutes);

// ─── Swagger / OpenAPI ────────────────────────────────────────
if (env.api.swaggerEnabled) {
  const spec = buildSpec();
  app.get('/openapi.json', (_req, res) => res.json(spec));
  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(spec, {
      customSiteTitle: 'OGM Gönüllü API — Swagger UI',
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
    }),
  );
  logger.info('Swagger UI etkin', { path: '/docs', spec: '/openapi.json' });
}

// ─── API v1 modülleri ─────────────────────────────────────────
app.use('/v1/auth/phone', phoneAuthRoutes);
app.use('/v1/auth/edevlet', edevletAuthRoutes);
app.use('/v1/auth', tokenRoutes);
app.use('/v1/onboarding', onboardingRoutes);
app.use('/v1/reference', referenceRoutes);

// Kullanıcı-kapsamlı (spesifik) uçlar — genel /v1/users mount'undan ÖNCE eşleşmeli.
app.use('/v1/users/me/missions', userMissionsRoutes);
app.use('/v1/users/me/trainings', userTrainingsRoutes);
app.use('/v1/users/me/equipment', equipmentRoutes);
app.use('/v1/users/me/fire-reports', userFireReportsRoutes);
app.use('/v1/users/me/notifications', notificationPreferencesRoutes);
app.use('/v1/users', usersRoutes);

app.use('/v1/home', homeRoutes);
app.use('/v1/missions', missionsRoutes);
app.use('/v1/trainings', trainingsRoutes);
app.use('/v1/fire-reports', fireReportsRoutes);
app.use('/v1/emergency', emergencyRoutes);
app.use('/v1/notifications', notificationsRoutes);
app.use('/v1/legal', legalRoutes);
app.use('/v1/blog', blogRoutes);
app.use('/v1/admin', adminRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

app.locals.env = env;

module.exports = app;
