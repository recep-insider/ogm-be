'use strict';

require('dotenv').config();

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: toInt(process.env.PORT, 3000),

  api: {
    baseUrl: process.env.API_URL || `http://localhost:${process.env.PORT || 3000}`,
    appUrl: process.env.APP_URL || 'http://localhost',
    swaggerEnabled: toBool(process.env.SWAGGER_ENABLED, true),
  },

  db: {
    host: process.env.DB_HOST || 'mysql',
    port: toInt(process.env.DB_PORT, 3306),
    name: process.env.DB_NAME || 'ogm_gonullu',
    user: process.env.DB_USER || 'ogm_app',
    password: process.env.DB_PASSWORD || '',
  },

  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: toInt(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'change_me_access_secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'change_me_refresh_secret',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    registrationExpiresIn: process.env.JWT_REGISTRATION_EXPIRES_IN || '30m',
  },

  sms: {
    provider: process.env.SMS_PROVIDER || 'mock',
    apiUrl: process.env.SMS_API_URL || '',
    apiKey: process.env.SMS_API_KEY || '',
    apiSecret: process.env.SMS_API_SECRET || '',
    senderId: process.env.SMS_SENDER_ID || 'OGM GONULLU',
    otpLength: toInt(process.env.SMS_OTP_LENGTH, 6),
    otpExpiresIn: toInt(process.env.SMS_OTP_EXPIRES_IN, 300),
    otpMaxAttempts: toInt(process.env.SMS_OTP_MAX_ATTEMPTS, 5),
    otpLockoutDuration: toInt(process.env.SMS_OTP_LOCKOUT_DURATION, 1800),
    dailyLimitPerUser: toInt(process.env.SMS_DAILY_LIMIT_PER_USER, 10),
    resendCooldown: toInt(process.env.SMS_RESEND_COOLDOWN, 30),
    dummyPhones: (process.env.OTP_DUMMY_PHONES || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    dummyCode: process.env.OTP_DUMMY_CODE || '123456',
  },

  edevlet: {
    enabled: toBool(process.env.EDEVLET_ENABLED, false),
    mockMode: toBool(process.env.EDEVLET_MOCK_MODE, true),
    authorizeUrl:
      process.env.EDEVLET_AUTHORIZE_URL ||
      'https://sanal-test.turkiye.gov.tr/oauth/authorize',
    tokenUrl:
      process.env.EDEVLET_TOKEN_URL ||
      'https://sanal-test.turkiye.gov.tr/oauth/token',
    userInfoUrl:
      process.env.EDEVLET_USERINFO_URL ||
      'https://sanal-test.turkiye.gov.tr/oauth/userinfo',
    clientId: process.env.EDEVLET_CLIENT_ID || '',
    clientSecret: process.env.EDEVLET_CLIENT_SECRET || '',
    callbackUrl:
      process.env.EDEVLET_CALLBACK_URL ||
      'https://api.ogm-gonullu.gov.tr/v1/auth/edevlet/callback',
    sessionTtl: toInt(process.env.EDEVLET_SESSION_TTL, 600),
  },

  upload: {
    dir: process.env.UPLOAD_DIR || '/app/uploads',
    publicBaseUrl: process.env.UPLOAD_PUBLIC_BASE_URL || '',
    maxDocBytes: toInt(process.env.UPLOAD_MAX_DOC_BYTES, 10 * 1024 * 1024),
    // Video için ayrı limit — maxDocBytes (10MB) ~15sn üzeri 1080p galeri
    // videosunu kesiyordu; FE videoyu resize etmediği için sunucu limiti geniş.
    maxVideoBytes: toInt(process.env.UPLOAD_MAX_VIDEO_BYTES, 100 * 1024 * 1024),
    maxAvatarBytes: toInt(process.env.UPLOAD_MAX_AVATAR_BYTES, 5 * 1024 * 1024),
    maxReportPhotos: toInt(process.env.UPLOAD_MAX_REPORT_PHOTOS, 5),
  },

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: toInt(process.env.SMTP_PORT, 587),
    secure: toBool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    fromName: process.env.SMTP_FROM_NAME || 'OGM Gönüllü Sistemi',
    fromEmail: process.env.SMTP_FROM_EMAIL || 'noreply@ogm.gov.tr',
  },

  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    credentialsPath: process.env.FIREBASE_CREDENTIALS_PATH || '',
  },

  push: {
    provider: process.env.PUSH_PROVIDER || 'mock',
  },

  admin: {
    apiKey: process.env.ADMIN_API_KEY || '',
    // Saha amiri (officer) scan endpoint'i için ayrı anahtar; boşsa adminApiKey kullanılır.
    officerApiKey: process.env.OFFICER_API_KEY || '',
    // QR imzalı token doğrulaması için opsiyonel HMAC secret (B.1).
    scanHmacSecret: process.env.SCAN_HMAC_SECRET || '',
    // First admin account seed (idempotent). No-op when both are empty.
    seedEmail: process.env.ADMIN_SEED_EMAIL || '',
    seedPassword: process.env.ADMIN_SEED_PASSWORD || '',
    seedAd: process.env.ADMIN_SEED_AD || 'Sistem',
    seedSoyad: process.env.ADMIN_SEED_SOYAD || 'Yöneticisi',
    // Login security: bcrypt cost and IP-based brute-force lockout
    // (not email-based — to avoid account-lockout DoS).
    bcryptRounds: toInt(process.env.ADMIN_BCRYPT_ROUNDS, 12),
    loginMaxAttempts: toInt(process.env.ADMIN_LOGIN_MAX_ATTEMPTS, 10),
    loginLockoutDuration: toInt(process.env.ADMIN_LOGIN_LOCKOUT_DURATION, 900),
  },

  geo: {
    nominatimUrl: process.env.NOMINATIM_URL || '',
  },

  reports: {
    // Rapor zaman serisi kovalarının saat dilimi (panel kullanıcılarının yereli; TR'de DST yok).
    tzOffset: process.env.REPORT_TZ_OFFSET || '+03:00',
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || '/app/logs',
  },
};

module.exports = env;
