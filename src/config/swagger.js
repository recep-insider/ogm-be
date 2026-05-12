'use strict';

const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');
const env = require('./env');

const baseUrl = env.api.baseUrl || `http://localhost:${env.port}`;

const definition = {
  openapi: '3.0.3',
  info: {
    title: 'OGM Gönüllü Yönetim Sistemi API',
    version: '0.1.0',
    description:
      'T.C. Orman Genel Müdürlüğü Gönüllü Yönetim Sistemi backend API\'si. ' +
      'Auth (e-Devlet + Telefon OTP), onboarding, profil, ana sayfa, yangın bildirimi ve referans veri uçlarını içerir.',
    contact: {
      name: 'OGM Gönüllü Backend',
      email: 'gonullu-sistem@ogm.gov.tr',
    },
    license: { name: 'Proprietary' },
  },
  servers: [
    { url: `${baseUrl}/v1`, description: 'API v1' },
    { url: baseUrl, description: 'Kök (health vb.)' },
  ],
  tags: [
    { name: 'Health', description: 'Liveness/readiness uçları' },
    { name: 'Auth - Phone', description: 'Telefon + OTP akışı' },
    { name: 'Auth - e-Devlet', description: 'e-Devlet OAuth akışı' },
    { name: 'Auth - Token', description: 'Token yenileme & logout' },
    { name: 'Onboarding', description: 'Gönüllü başvuru formu' },
    { name: 'Reference', description: 'Sabit listeler (kan grubu vb.)' },
    { name: 'Users', description: 'Kullanıcı profili & avatar' },
    { name: 'Home', description: 'Ana sayfa feed' },
    { name: 'Reports', description: 'Yangın bildirimi' },
    { name: 'Notifications', description: 'FCM cihaz kaydı' },
    { name: 'Legal', description: 'KVKK & rıza metinleri' },
    { name: 'Trainings', description: 'Gönüllü eğitimleri' },
    { name: 'Blog', description: 'Haber & duyurular' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Erişim token\'ı (`Authorization: Bearer <token>`)',
      },
      registrationToken: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Telefon doğrulama sonrası kayıt formu için kısa süreli token',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string', example: 'VALIDATION_ERROR' },
              message: { type: 'string', example: 'Form alanlarında hata var' },
              details: { type: 'object', additionalProperties: true },
            },
          },
        },
      },
      ValidationErrorItem: {
        type: 'object',
        properties: {
          field: { type: 'string', example: 'kimlik.tcKimlik' },
          message: { type: 'string', example: 'Geçerli bir TC Kimlik numarası giriniz' },
        },
      },
      KanGrubu: {
        type: 'string',
        enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', '0+', '0-'],
      },
      Ogrenim: {
        type: 'string',
        enum: ['Lise', 'Ön Lisans', 'Lisans', 'Yüksek Lisans', 'Doktora', 'Diğer'],
      },
      Meslek: {
        type: 'string',
        enum: ['Memur', 'Öğretmen', 'Mühendis', 'Öğrenci', 'Emekli', 'Diğer'],
      },
      Yakinlik: {
        type: 'string',
        enum: ['Anne', 'Baba', 'Eş', 'Kardeş', 'Arkadaş', 'Diğer'],
      },
      ApplicationStatus: {
        type: 'string',
        enum: ['pending', 'approved', 'rejected', 'requires_revision'],
      },
      AuthTokenPair: {
        type: 'object',
        properties: {
          accessToken: { type: 'string' },
          refreshToken: { type: 'string' },
          expiresIn: { type: 'integer', example: 900 },
        },
      },
      UserPublic: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          tcKimlik: { type: 'string', example: '10000000146', nullable: true },
          ad: { type: 'string', nullable: true },
          soyad: { type: 'string', nullable: true },
          dogumTarihi: { type: 'string', format: 'date', nullable: true },
          phone: { type: 'string', example: '+905321234567', nullable: true },
          eposta: { type: 'string', format: 'email', nullable: true },
          profileComplete: { type: 'boolean' },
        },
      },
      UserProfile: {
        allOf: [
          { $ref: '#/components/schemas/UserPublic' },
          {
            type: 'object',
            properties: {
              adres: { type: 'string', nullable: true },
              kanGrubu: { $ref: '#/components/schemas/KanGrubu' },
              ogrenim: { $ref: '#/components/schemas/Ogrenim' },
              meslek: { $ref: '#/components/schemas/Meslek' },
              meslekDiger: { type: 'string', nullable: true },
              hobiler: { type: 'array', items: { type: 'string' } },
              acil: { $ref: '#/components/schemas/AcilIletisim' },
              applicationStatus: { $ref: '#/components/schemas/ApplicationStatus' },
              volunteerLevel: { $ref: '#/components/schemas/VolunteerLevel' },
              avatarUrl: { type: 'string', format: 'uri', nullable: true },
            },
          },
        ],
      },
      AcilIletisim: {
        type: 'object',
        properties: {
          ad: { type: 'string' },
          soyad: { type: 'string' },
          telefon: { type: 'string', example: '+905321112233' },
          yakinlik: { $ref: '#/components/schemas/Yakinlik' },
        },
      },
      VolunteerLevel: {
        type: 'object',
        properties: {
          level: { type: 'integer', example: 2 },
          name: { type: 'string', example: 'Aktif Gönüllü' },
          progressPercent: { type: 'integer', minimum: 0, maximum: 100, example: 75 },
          trainingsRemaining: { type: 'integer', example: 2 },
        },
      },
      ReferenceItem: {
        type: 'object',
        properties: {
          value: { type: 'string', example: 'A+' },
          label: { type: 'string', example: 'A+' },
        },
      },
      EmergencyAction: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          reportsToday: { type: 'integer' },
        },
      },
      ActiveTasks: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'object', additionalProperties: true } },
          permissionRequired: {
            type: 'string',
            enum: ['location', 'notification'],
            nullable: true,
          },
        },
      },
      Training: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          description: { type: 'string' },
          durationMin: { type: 'integer' },
          status: {
            type: 'string',
            enum: ['not_started', 'in_progress', 'completed'],
          },
        },
      },
      News: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          type: { type: 'string', enum: ['haber', 'duyuru'] },
          title: { type: 'string' },
          imageUrl: { type: 'string', format: 'uri', nullable: true },
          publishedAt: { type: 'string', format: 'date-time' },
          url: { type: 'string', format: 'uri', nullable: true },
        },
      },
      OnboardingData: {
        type: 'object',
        required: ['kimlik', 'iletisim', 'kisisel', 'acil'],
        properties: {
          kimlik: {
            type: 'object',
            required: ['tcKimlik', 'ad', 'soyad', 'dogumTarihi'],
            properties: {
              tcKimlik: { type: 'string', example: '10000000146' },
              ad: { type: 'string' },
              soyad: { type: 'string' },
              dogumTarihi: { type: 'string', format: 'date' },
            },
          },
          iletisim: {
            type: 'object',
            required: ['eposta', 'adres'],
            properties: {
              telefon: { type: 'string', example: '+905321234567', nullable: true },
              eposta: { type: 'string', format: 'email' },
              adres: { type: 'string', minLength: 10, maxLength: 500 },
            },
          },
          kisisel: {
            type: 'object',
            required: ['kanGrubu', 'ogrenim', 'meslek', 'hobiler'],
            properties: {
              kanGrubu: { $ref: '#/components/schemas/KanGrubu' },
              ogrenim: { $ref: '#/components/schemas/Ogrenim' },
              meslek: { $ref: '#/components/schemas/Meslek' },
              meslekDiger: { type: 'string', nullable: true, minLength: 2 },
              hobiler: { type: 'array', items: { type: 'string' }, minItems: 1 },
            },
          },
          acil: { $ref: '#/components/schemas/AcilIletisim' },
        },
      },
    },
    responses: {
      ValidationError: {
        description: 'Validation hatası',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
      Unauthorized: {
        description: 'Kimlik doğrulanamadı veya token geçersiz',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
      Forbidden: {
        description: 'Yetki yok',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
      NotFound: {
        description: 'Kaynak bulunamadı',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
      RateLimited: {
        description: 'İstek limiti aşıldı',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
    },
  },
  security: [],
};


const options = {
  definition,
  apis: [
    path.join(__dirname, '..', 'modules', '**', '*.routes.js'),
    path.join(__dirname, '..', 'modules', '**', '*.docs.js'),
  ],
};

function buildSpec() {
  return swaggerJsdoc(options);
}

module.exports = { buildSpec };
