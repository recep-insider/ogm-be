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
    { name: 'Missions', description: 'Aktif görevler & görev geçmişi' },
    { name: 'Trainings', description: 'Online/saha eğitimleri & aldığım eğitimler' },
    { name: 'Equipment', description: 'Zimmetli ekipmanlar' },
    { name: 'Fire Reports', description: 'Yangın ihbarı' },
    { name: 'Emergency', description: 'Acil durum bildirimi' },
    { name: 'Notifications', description: 'FCM cihaz kaydı & bildirim tercihleri' },
    { name: 'Legal', description: 'KVKK & rıza metinleri' },
    { name: 'Blog', description: 'Haber & duyurular' },
    { name: 'Admin', description: 'Panel/saha amiri uçları (mobil çağırmaz)' },
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
      adminApiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
        description: 'Panel admin anahtarı (ADMIN_API_KEY)',
      },
      officerApiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
        description: 'Saha amiri anahtarı (OFFICER_API_KEY)',
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
              code: { type: 'string', example: 'validation_error' },
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
          applicationStatus: { $ref: '#/components/schemas/ApplicationStatus' },
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
              giysiBedeni: { type: 'string', enum: ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'], nullable: true },
              ayakkabiNumarasi: { type: 'integer', minimum: 34, maximum: 50, nullable: true },
              acil: { $ref: '#/components/schemas/AcilIletisim' },
              volunteerLevel: { $ref: '#/components/schemas/VolunteerLevel' },
              avatarUrl: { type: 'string', format: 'uri', nullable: true },
              hasProtectiveEquipment: { type: 'boolean' },
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
              hobiler: { type: 'array', items: { type: 'string' } },
            },
          },
          acil: { $ref: '#/components/schemas/AcilIletisim' },
          egitim: {
            type: 'object',
            description:
              'Eğitim başvuru bilgileri. il/ilce/bolgeMudurlugu/isletmeMudurlugu kanonik birim listesine '
              + '(forest_units) karşı doğrulanır. Yeni frontend rollout\'u tamamlanana kadar opsiyonel.',
            required: ['il', 'ilce', 'bolgeMudurlugu', 'isletmeMudurlugu', 'giysiBedeni', 'ayakkabiNumarasi'],
            properties: {
              il: { type: 'string', example: 'Antalya' },
              ilce: { type: 'string', example: 'Alanya' },
              bolgeMudurlugu: { type: 'string', example: 'Antalya Orman Bölge Müdürlüğü' },
              isletmeMudurlugu: { type: 'string', example: 'Alanya Orman İşletme Müdürlüğü' },
              giysiBedeni: { type: 'string', enum: ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'] },
              ayakkabiNumarasi: { type: 'integer', minimum: 34, maximum: 50 },
              aciklama: { type: 'string', maxLength: 500, nullable: true },
            },
          },
        },
      },
      ActiveMissionSummary: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          category: { type: 'string', example: 'LOJİSTİK DESTEK' },
          title: { type: 'string' },
          shortLocation: { type: 'string', example: 'Muğla / Marmaris' },
          iconName: { type: 'string', enum: ['water', 'helmet', 'tool', 'first-aid'] },
          status: { type: 'string', enum: ['active', 'staffed'] },
          userStatus: { type: 'string', enum: ['not_joined', 'accepted', 'on_site'] },
        },
      },
      ActiveMissionDetail: {
        allOf: [
          { $ref: '#/components/schemas/ActiveMissionSummary' },
          {
            type: 'object',
            properties: {
              regionLabel: { type: 'string' },
              fullTitle: { type: 'string' },
              description: { type: 'string' },
              gallery: { type: 'array', items: { type: 'string', format: 'uri' } },
              needs: { type: 'array', items: { type: 'string' } },
              stats: {
                type: 'object',
                properties: { volunteers: { type: 'integer' }, hectares: { type: 'number' } },
              },
              locationLabel: { type: 'string' },
              startedAt: { type: 'string', format: 'date-time' },
              coordinates: {
                type: 'object',
                properties: { lat: { type: 'number' }, lng: { type: 'number' } },
              },
              coverageRadiusKm: { type: 'number' },
              operational: {
                type: 'object',
                properties: {
                  meetingPoint: { type: 'string' },
                  requiredEquipment: { type: 'string' },
                },
              },
              announcements: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    message: { type: 'string' },
                    publishedAt: { type: 'string', format: 'date-time' },
                    severity: { type: 'string', enum: ['info', 'alert'] },
                  },
                },
              },
            },
          },
        ],
      },
      FireMissionSummary: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          location: { type: 'string' },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          status: { type: 'string', enum: ['active', 'completed'] },
          cover: { type: 'string', format: 'uri', nullable: true },
        },
      },
      FireMissionDetail: {
        allOf: [
          { $ref: '#/components/schemas/FireMissionSummary' },
          {
            type: 'object',
            properties: {
              subtitle: { type: 'string', nullable: true },
              gallery: { type: 'array', items: { type: 'string', format: 'uri' } },
              summary: { type: 'string' },
              stats: {
                type: 'object',
                properties: { hectares: { type: 'number' }, volunteers: { type: 'integer' } },
              },
            },
          },
        ],
      },
      OnlineTraining: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          durationMin: { type: 'integer' },
          iconTone: { type: 'string', enum: ['primary', 'tertiary'] },
          videoUrl: { type: 'string', format: 'uri', nullable: true },
          status: { type: 'string', enum: ['not_started', 'in_progress', 'completed'] },
          progressPercent: { type: 'integer', minimum: 0, maximum: 100 },
        },
      },
      SahaTraining: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          location: { type: 'string' },
          startDate: { type: 'string', format: 'date' },
          startTime: { type: 'string', example: '09:00' },
          endTime: { type: 'string', example: '17:00' },
          instructorName: { type: 'string' },
          instructorAvatar: { type: 'string', format: 'uri', nullable: true },
          cover: { type: 'string', format: 'uri', nullable: true },
          availableSeats: { type: 'integer' },
          seatStatus: { type: 'string', enum: ['available', 'last_seats'] },
          applied: { type: 'boolean' },
        },
      },
      CompletedTraining: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          durationMin: { type: 'integer' },
          completedAt: { type: 'string', format: 'date', nullable: true },
          instructorName: { type: 'string', nullable: true },
          progressPercent: { type: 'integer' },
          status: { type: 'string', enum: ['completed', 'in_progress'] },
          certificateUrl: { type: 'string', format: 'uri', nullable: true },
        },
      },
      EquipmentItem: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string' },
          assignedAt: { type: 'string', format: 'date' },
          expiresAt: { type: 'string', format: 'date', nullable: true },
          status: { type: 'string', enum: ['active', 'expiring_soon', 'expired'] },
          iconName: { type: 'string' },
        },
      },
      BlogPost: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          cover: { type: 'string', format: 'uri', nullable: true },
          publishedAt: { type: 'string', format: 'date' },
          readTimeMin: { type: 'integer' },
          themes: { type: 'array', items: { type: 'string' } },
          author: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              role: { type: 'string' },
              avatar: { type: 'string', format: 'uri', nullable: true },
            },
          },
          content: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['paragraph', 'heading', 'image'] },
                text: { type: 'string' },
                source: { type: 'string', format: 'uri' },
              },
            },
          },
        },
      },
      NotificationPreferences: {
        type: 'object',
        properties: {
          taskCalls: { type: 'boolean' },
          trainings: { type: 'boolean' },
          announcements: { type: 'boolean' },
          distance: {
            type: 'object',
            properties: {
              km: { type: 'integer' },
              min: { type: 'integer' },
              max: { type: 'integer' },
            },
          },
        },
      },
      FireReportSummary: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          locationName: { type: 'string' },
          regionLabel: { type: 'string' },
          status: { type: 'string', enum: ['reviewing', 'confirmed', 'rejected'] },
          submittedAt: { type: 'string', format: 'date-time' },
          coordinates: {
            type: 'object',
            properties: { lat: { type: 'number' }, lng: { type: 'number' } },
          },
          needs: { type: 'array', items: { type: 'string' } },
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
      PayloadTooLarge: {
        description: 'Dosya boyutu sınırı aşıldı',
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
