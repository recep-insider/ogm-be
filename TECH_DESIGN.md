# Orman Yangınları Gönüllü Yönetim Sistemi — Technical Design Document

> **Proje:** T.C. Orman Genel Müdürlüğü — Gönüllü Yönetim Sistemi
> **Versiyon:** 1.0 (MVP)
> **Tarih:** 2026-03-16

---

## İçindekiler

1. [Mimari Genel Bakış (On-Premise)](#1-mimari-genel-bakış)
2. [Teknoloji Stack](#2-teknoloji-stack)
3. [Veritabanı Tasarımı](#3-veritabanı-tasarımı)
4. [Kimlik Doğrulama & Yetkilendirme](#4-kimlik-doğrulama--yetkilendirme)
5. [API Endpoint Tasarımı](#5-api-endpoint-tasarımı)
6. [3rd Party Entegrasyonlar (On-Premise Odaklı)](#6-3rd-party-entegrasyonlar)
7. [Bildirim Altyapısı](#7-bildirim-altyapısı)
8. [Dosya Yönetimi (MinIO)](#8-dosya-yönetimi)
9. [Hata Yönetimi & Loglama](#9-hata-yönetimi--loglama)
10. [Güvenlik](#10-güvenlik)
11. [Deployment & DevOps (On-Premise Docker)](#11-deployment--devops)

---

## 1. Mimari Genel Bakış

### 1.1 Sistem Mimarisi (On-Premise)

> **Dağıtım Modeli:** Tüm bileşenler kurumun kendi veri merkezinde (on-premise) Docker container'ları olarak çalışır. Dış dünyaya yalnızca Nginx reverse proxy üzerinden HTTPS erişimi açılır. Push notification için FCM'e outbound internet erişimi gereklidir.

```
                          ┌─────────────────────────────────────────┐
                          │         OGM Veri Merkezi (DMZ)          │
                          │                                         │
  ┌──────────┐            │   ┌────────────────┐                    │
  │ Mobile   │──HTTPS────►│   │  Nginx          │                   │
  │ App      │            │   │  (Reverse Proxy  │                   │
  └──────────┘            │   │   + SSL + Static)│                   │
  ┌──────────┐            │   └───────┬──────────┘                   │
  │ Admin    │──HTTPS────►│           │                              │
  │ Panel    │            │   ┌───────▼──────────┐                   │
  └──────────┘            │   │  Node.js Backend  │                  │
                          │   │  (Express)        │                  │
                          │   │  [PM2 Cluster]    │                  │
                          │   └───────┬──────────┘                   │
                          │           │                              │
                          │   ┌───────┼──────────┬──────────┐       │
                          │   │       │          │          │       │
                          │ ┌─▼──┐ ┌──▼───┐ ┌───▼───┐ ┌───▼────┐  │
                          │ │MySQL│ │Redis │ │MinIO  │ │Nominatim│  │
                          │ │ 8.0│ │ 7.x  │ │(S3)   │ │(Geo)   │  │
                          │ └────┘ └──────┘ └───────┘ └────────┘  │
                          │                                         │
                          │   ── Outbound HTTPS ──►  FCM (Google)   │
                          │   ── Outbound HTTPS ──►  SMS Sağlayıcı  │
                          │   ── Outbound SMTP  ──►  Kurumsal SMTP  │
                          └─────────────────────────────────────────┘
```

### 1.2 Katmanlı Mimari (Layered Architecture)

```
ogm-gonullu/
├── docker/                  # Docker & deployment dosyaları
│   ├── docker-compose.yml   # Tüm servisleri ayağa kaldırır
│   ├── docker-compose.dev.yml
│   ├── Dockerfile           # Node.js backend image
│   ├── nginx/
│   │   ├── nginx.conf       # Reverse proxy + SSL config
│   │   └── ssl/             # Sertifika dosyaları
│   ├── mysql/
│   │   └── init.sql         # İlk kurulum script'i
│   └── minio/
│       └── policies/        # Bucket access policy'leri
├── src/
│   ├── config/              # Yapılandırma dosyaları (db, redis, minio, env)
│   ├── middlewares/          # Auth, validation, rate-limit, error-handler
│   ├── modules/
│   │   ├── auth/            # Kimlik doğrulama (email/password, JWT)
│   │   ├── volunteers/      # Gönüllü profil yönetimi
│   │   ├── trainings/       # Eğitim modülü
│   │   ├── inventory/       # Envanter & zimmet
│   │   ├── fires/           # Yangın bildirme & yönetim
│   │   ├── sos/             # Acil durum bildirimi
│   │   ├── notifications/   # Bildirim & çağrı sistemi
│   │   ├── blog/            # İçerik (blog) alanı
│   │   └── admin/           # Admin panel & dashboard
│   ├── shared/              # Ortak utility, helper, constants
│   ├── jobs/                # Cron job'lar (SKT kontrolü, vb.)
│   ├── app.js               # Express app setup
│   └── server.js            # Server entry point
├── migrations/              # Knex.js migration dosyaları
├── seeds/                   # Seed data
├── scripts/                 # Bakım & yedekleme script'leri
│   ├── backup.sh            # Otomatik yedekleme
│   ├── restore.sh           # Yedekten geri yükleme
│   └── health-check.sh      # Sağlık kontrolü
└── .env.example             # Ortam değişkenleri şablonu
```

Her modül kendi içinde şu yapıyı takip eder:

```
modules/volunteers/
├── volunteer.controller.js   # Route handler'lar
├── volunteer.service.js      # İş mantığı
├── volunteer.repository.js   # Veritabanı sorguları
├── volunteer.validator.js    # Request validation (Joi)
├── volunteer.routes.js       # Route tanımları
└── volunteer.dto.js          # Data Transfer Objects
```

---

## 2. Teknoloji Stack

### 2.1 Backend

| Katman | Teknoloji | Versiyon | Açıklama |
|--------|-----------|----------|----------|
| Runtime | Node.js | 20 LTS | JavaScript runtime |
| Framework | Express.js | 4.x | HTTP framework |
| ORM | Knex.js | 3.x | SQL query builder & migration |
| Veritabanı | MySQL | 8.0 | İlişkisel veritabanı (on-premise Docker) |
| Cache | Redis | 7.x | Session cache, rate limiting (on-premise Docker) |
| Validation | Joi | 17.x | Request validation |
| Auth | jsonwebtoken | 9.x | JWT token üretimi |
| Dosya Depolama | MinIO | RELEASE | S3-uyumlu object storage (on-premise Docker) |
| Push Notification | Firebase Cloud Messaging (FCM) | - | Push bildirim (outbound HTTPS gerektirir) |
| Reverse Geocoding | Nominatim | 4.x | OpenStreetMap tabanlı (on-premise Docker, opsiyonel) |
| Reverse Proxy | Nginx | 1.25+ | SSL termination, static file serving, load balancing |
| Loglama | Winston | 3.x | Yapısal loglama (dosya + stdout) |
| API Docs | Swagger (swagger-jsdoc) | - | API dokümantasyonu |
| Test | Jest + Supertest | - | Unit & integration test |
| Process Manager | PM2 | - | Production process management |
| Container | Docker + Docker Compose | 24.x / 2.x | On-premise container orchestration |
| Monitoring | Prometheus + Grafana | - | Metrik toplama & dashboard (opsiyonel) |

### 2.2 Yardımcı Kütüphaneler

| Kütüphane | Amaç |
|-----------|------|
| `helmet` | HTTP güvenlik header'ları |
| `cors` | Cross-Origin Resource Sharing |
| `express-rate-limit` | Rate limiting |
| `multer` | Dosya upload (fotoğraf) |
| `node-cron` | Zamanlanmış görevler (SKT kontrolü vb.) |
| `bcrypt` | Parola hash'leme |
| `nodemailer` | E-posta gönderimi (doğrulama, parola sıfırlama) |
| `uuid` | Unique ID üretimi |
| `dotenv` | Ortam değişkenleri |
| `compression` | Response sıkıştırma |

---

## 3. Veritabanı Tasarımı

### 3.1 ER Diyagramı — Tablo İlişkileri

```
users ──< volunteer_profiles
users ──< admin_profiles
users ──< user_sessions

volunteer_profiles ──< volunteer_trainings >── trainings
volunteer_profiles ──< volunteer_equipment >── equipment_types
volunteer_profiles ──< fire_participants >── fires
volunteer_profiles ──< volunteer_evaluations >── fires
volunteer_profiles ──< sos_alerts
volunteer_profiles ──< fire_reports
fire_reports ──< fire_report_media

fires ──< fire_participants
fires ──< fire_notifications
fires ──< volunteer_evaluations

notifications ──< notification_recipients >── volunteer_profiles

blog_posts (admin tarafından yönetilir)
```

### 3.2 Tablolar

---

#### `users`
Tüm kullanıcıların (gönüllü + admin) temel kimlik tablosu.

| Alan | Tip | Kısıtlama | Açıklama |
|------|-----|-----------|----------|
| `id` | BIGINT UNSIGNED | PK, AUTO_INCREMENT | Birincil anahtar |
| `tc_kimlik_no` | VARCHAR(11) | UNIQUE, NULL | T.C. Kimlik numarası |
| `email` | VARCHAR(255) | UNIQUE, NOT NULL | E-posta adresi |
| `password_hash` | VARCHAR(255) | NOT NULL | Şifre (bcrypt) |
| `phone` | VARCHAR(20) | UNIQUE, NULL | Telefon numarası (E.164 format: +905xx...) |
| `phone_verified` | BOOLEAN | NOT NULL, DEFAULT FALSE | Telefon doğrulandı mı |
| `phone_verified_at` | DATETIME | NULL | Telefon doğrulama zamanı |
| `phone_otp_code` | VARCHAR(6) | NULL | SMS doğrulama kodu (6 haneli) |
| `phone_otp_expires` | DATETIME | NULL | OTP geçerlilik süresi (5 dk) |
| `phone_otp_attempts` | TINYINT UNSIGNED | NOT NULL, DEFAULT 0 | Yanlış OTP deneme sayısı (maks 5) |
| `role` | ENUM('volunteer', 'admin', 'ogm_officer') | NOT NULL, DEFAULT 'volunteer' | Kullanıcı rolü |
| `status` | ENUM('pending', 'active', 'suspended', 'inactive') | NOT NULL, DEFAULT 'pending' | Hesap durumu |
| `email_verified` | BOOLEAN | NOT NULL, DEFAULT FALSE | E-posta doğrulandı mı |
| `email_verified_at` | DATETIME | NULL | E-posta doğrulama zamanı |
| `password_reset_token` | VARCHAR(255) | NULL | Parola sıfırlama token'ı |
| `password_reset_expires` | DATETIME | NULL | Token geçerlilik süresi |
| `last_login_at` | DATETIME | NULL | Son giriş zamanı |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | Oluşturulma zamanı |
| `updated_at` | DATETIME | NOT NULL, DEFAULT NOW() ON UPDATE | Güncellenme zamanı |

**Index:** `idx_users_email(email)`, `idx_users_phone(phone)`, `idx_users_tc_kimlik(tc_kimlik_no)`, `idx_users_role(role)`, `idx_users_status(status)`

---

#### `volunteer_profiles`
Gönüllülere özel profil bilgileri.

| Alan | Tip | Kısıtlama | Açıklama |
|------|-----|-----------|----------|
| `id` | BIGINT UNSIGNED | PK, AUTO_INCREMENT | |
| `user_id` | BIGINT UNSIGNED | FK → users.id, UNIQUE | |
| `first_name` | VARCHAR(100) | NOT NULL | Ad |
| `last_name` | VARCHAR(100) | NOT NULL | Soyad |
| `birth_date` | DATE | NOT NULL | Doğum tarihi |
| `blood_type` | ENUM('A+','A-','B+','B-','AB+','AB-','0+','0-') | NULL | Kan grubu |
| `residence_city` | VARCHAR(100) | NULL | İkamet ili |
| `residence_district` | VARCHAR(100) | NULL | İkamet ilçesi |
| `residence_address` | TEXT | NULL | Adres detayı |
| `profession` | VARCHAR(150) | NULL | Meslek |
| `skills` | TEXT | NULL | Hobiler / beceriler (JSON array) |
| `criminal_record_clear` | BOOLEAN | NULL | Sabıka durumu |
| `emergency_contact_name` | VARCHAR(200) | NOT NULL | Acil durumda aranacak kişi adı |
| `emergency_contact_phone` | VARCHAR(20) | NOT NULL | Acil durumda aranacak kişi telefon |
| `volunteer_notes` | TEXT | NULL | Gönüllülükle ilgili ek notlar |
| `identity_card_status` | ENUM('none', 'issued', 'revoked') | NOT NULL, DEFAULT 'none' | Gönüllü kimlik kartı durumu |
| `identity_card_issued_at` | DATE | NULL | Kimlik kartı verilme tarihi |
| `profile_photo_url` | VARCHAR(500) | NULL | Profil fotoğrafı URL |
| `latitude` | DECIMAL(10, 8) | NULL | Son bilinen enlem |
| `longitude` | DECIMAL(11, 8) | NULL | Son bilinen boylam |
| `location_updated_at` | DATETIME | NULL | Konum güncelleme zamanı |
| `is_migrated` | BOOLEAN | NOT NULL, DEFAULT FALSE | Eski sistemden migrate edilmiş mi |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | |
| `updated_at` | DATETIME | NOT NULL, DEFAULT NOW() ON UPDATE | |

**Index:** `idx_vp_user(user_id)`, `idx_vp_city(residence_city)`, `idx_vp_card_status(identity_card_status)`, `SPATIAL idx_vp_location(latitude, longitude)`

---

#### `admin_profiles`
Admin ve OGM görevlilerine özel profil bilgileri.

| Alan | Tip | Kısıtlama | Açıklama |
|------|-----|-----------|----------|
| `id` | BIGINT UNSIGNED | PK, AUTO_INCREMENT | |
| `user_id` | BIGINT UNSIGNED | FK → users.id, UNIQUE | |
| `first_name` | VARCHAR(100) | NOT NULL | |
| `last_name` | VARCHAR(100) | NOT NULL | |
| `title` | VARCHAR(200) | NULL | Unvan |
| `department` | VARCHAR(200) | NULL | Birim / bölge |
| `permissions` | JSON | NULL | Özel yetki listesi |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | |
| `updated_at` | DATETIME | NOT NULL, DEFAULT NOW() ON UPDATE | |

**Index:** `idx_ap_user(user_id)`

---

#### `trainings`
Eğitim tanımları.

| Alan | Tip | Kısıtlama | Açıklama |
|------|-----|-----------|----------|
| `id` | BIGINT UNSIGNED | PK, AUTO_INCREMENT | |
| `title` | VARCHAR(300) | NOT NULL | Eğitim başlığı |
| `description` | TEXT | NULL | Açıklama |
| `type` | ENUM('online', 'offline') | NOT NULL | Eğitim türü |
| `location` | VARCHAR(300) | NULL | Yüz yüze eğitim konumu |
| `latitude` | DECIMAL(10, 8) | NULL | Eğitim yeri enlem |
| `longitude` | DECIMAL(11, 8) | NULL | Eğitim yeri boylam |
| `start_date` | DATETIME | NULL | Başlangıç tarihi |
| `end_date` | DATETIME | NULL | Bitiş tarihi |
| `capacity` | INT UNSIGNED | NULL | Kontenjan |
| `status` | ENUM('draft', 'published', 'ongoing', 'completed', 'cancelled') | NOT NULL, DEFAULT 'draft' | |
| `created_by` | BIGINT UNSIGNED | FK → users.id | Oluşturan admin |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | |
| `updated_at` | DATETIME | NOT NULL, DEFAULT NOW() ON UPDATE | |

**Index:** `idx_trainings_type(type)`, `idx_trainings_status(status)`, `idx_trainings_dates(start_date, end_date)`

---

#### `volunteer_trainings`
Gönüllülerin aldığı eğitimler (many-to-many).

| Alan | Tip | Kısıtlama | Açıklama |
|------|-----|-----------|----------|
| `id` | BIGINT UNSIGNED | PK, AUTO_INCREMENT | |
| `volunteer_id` | BIGINT UNSIGNED | FK → volunteer_profiles.id | |
| `training_id` | BIGINT UNSIGNED | FK → trainings.id | |
| `enrollment_date` | DATETIME | NOT NULL, DEFAULT NOW() | Kayıt tarihi |
| `completion_date` | DATETIME | NULL | Tamamlama tarihi |
| `status` | ENUM('enrolled', 'in_progress', 'completed', 'failed', 'cancelled') | NOT NULL, DEFAULT 'enrolled' | |
| `certificate_url` | VARCHAR(500) | NULL | Sertifika dosyası URL |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | |

**Index:** `UNIQUE idx_vt_vol_train(volunteer_id, training_id)`, `idx_vt_status(status)`

---

#### `equipment_types`
Ekipman türleri tanım tablosu.

| Alan | Tip | Kısıtlama | Açıklama |
|------|-----|-----------|----------|
| `id` | BIGINT UNSIGNED | PK, AUTO_INCREMENT | |
| `name` | VARCHAR(200) | NOT NULL | Ekipman adı (baret, eldiven, ayakkabı vb.) |
| `category` | VARCHAR(100) | NOT NULL | Kategori |
| `description` | TEXT | NULL | |
| `has_size` | BOOLEAN | NOT NULL, DEFAULT FALSE | Beden bilgisi var mı |
| `has_expiry` | BOOLEAN | NOT NULL, DEFAULT TRUE | SKT var mı |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | |

---

#### `equipment_stock`
Depo bazlı stok takibi.

| Alan | Tip | Kısıtlama | Açıklama |
|------|-----|-----------|----------|
| `id` | BIGINT UNSIGNED | PK, AUTO_INCREMENT | |
| `equipment_type_id` | BIGINT UNSIGNED | FK → equipment_types.id | |
| `size` | VARCHAR(20) | NULL | Beden (S, M, L, 42, 43 vb.) |
| `quantity` | INT UNSIGNED | NOT NULL, DEFAULT 0 | Mevcut adet |
| `warehouse_location` | VARCHAR(200) | NULL | Depo konumu |
| `updated_at` | DATETIME | NOT NULL, DEFAULT NOW() ON UPDATE | |

**Index:** `idx_es_type_size(equipment_type_id, size)`

---

#### `volunteer_equipment`
Gönüllülere zimmetli ekipmanlar.

| Alan | Tip | Kısıtlama | Açıklama |
|------|-----|-----------|----------|
| `id` | BIGINT UNSIGNED | PK, AUTO_INCREMENT | |
| `volunteer_id` | BIGINT UNSIGNED | FK → volunteer_profiles.id | |
| `equipment_type_id` | BIGINT UNSIGNED | FK → equipment_types.id | |
| `size` | VARCHAR(20) | NULL | Beden |
| `serial_number` | VARCHAR(100) | NULL | Seri numarası |
| `issued_date` | DATE | NOT NULL | Verilme tarihi |
| `expiry_date` | DATE | NULL | Son kullanma tarihi |
| `returned_date` | DATE | NULL | İade tarihi |
| `status` | ENUM('active', 'returned', 'expired', 'lost') | NOT NULL, DEFAULT 'active' | |
| `issued_by` | BIGINT UNSIGNED | FK → users.id | Zimmeti veren admin |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | |
| `updated_at` | DATETIME | NOT NULL, DEFAULT NOW() ON UPDATE | |

**Index:** `idx_ve_volunteer(volunteer_id)`, `idx_ve_expiry(expiry_date)`, `idx_ve_status(status)`

---

#### `fires`
Yangın kayıtları.

| Alan | Tip | Kısıtlama | Açıklama |
|------|-----|-----------|----------|
| `id` | BIGINT UNSIGNED | PK, AUTO_INCREMENT | |
| `title` | VARCHAR(300) | NULL | Yangın tanımı |
| `description` | TEXT | NULL | Detaylı açıklama |
| `latitude` | DECIMAL(10, 8) | NOT NULL | Enlem |
| `longitude` | DECIMAL(11, 8) | NOT NULL | Boylam |
| `city` | VARCHAR(100) | NULL | İl |
| `district` | VARCHAR(100) | NULL | İlçe |
| `status` | ENUM('reported', 'verified', 'active', 'contained', 'extinguished', 'false_alarm') | NOT NULL, DEFAULT 'reported' | |
| `severity` | ENUM('low', 'medium', 'high', 'critical') | NULL | Şiddet seviyesi |
| `started_at` | DATETIME | NULL | Yangın başlangıç zamanı |
| `contained_at` | DATETIME | NULL | Kontrol altına alma zamanı |
| `extinguished_at` | DATETIME | NULL | Söndürülme zamanı |
| `created_by` | BIGINT UNSIGNED | FK → users.id | Oluşturan (admin veya bildiren gönüllü) |
| `verified_by` | BIGINT UNSIGNED | FK → users.id, NULL | Doğrulayan admin |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | |
| `updated_at` | DATETIME | NOT NULL, DEFAULT NOW() ON UPDATE | |

**Index:** `idx_fires_status(status)`, `idx_fires_city(city)`, `SPATIAL idx_fires_location(latitude, longitude)`, `idx_fires_dates(started_at)`

---

#### `fire_reports`
Gönüllülerin gönderdiği yangın bildirimleri.

| Alan | Tip | Kısıtlama | Açıklama |
|------|-----|-----------|----------|
| `id` | BIGINT UNSIGNED | PK, AUTO_INCREMENT | |
| `volunteer_id` | BIGINT UNSIGNED | FK → volunteer_profiles.id | Bildiren gönüllü |
| `fire_id` | BIGINT UNSIGNED | FK → fires.id, NULL | Eşleşen yangın (admin onayı sonrası) |
| `latitude` | DECIMAL(10, 8) | NOT NULL | Konum enlem |
| `longitude` | DECIMAL(11, 8) | NOT NULL | Konum boylam |
| `description` | TEXT | NULL | Açıklama |
| `status` | ENUM('pending', 'reviewed', 'confirmed', 'rejected') | NOT NULL, DEFAULT 'pending' | |
| `reviewed_by` | BIGINT UNSIGNED | FK → users.id, NULL | İnceleyen admin |
| `reviewed_at` | DATETIME | NULL | |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | |

**Index:** `idx_fr_volunteer(volunteer_id)`, `idx_fr_status(status)`, `idx_fr_fire(fire_id)`

---

#### `fire_report_media`
Yangın bildirimlerine eklenen fotoğraf ve videolar. Her bildirime birden fazla medya eklenebilir.

| Alan | Tip | Kısıtlama | Açıklama |
|------|-----|-----------|----------|
| `id` | BIGINT UNSIGNED | PK, AUTO_INCREMENT | |
| `fire_report_id` | BIGINT UNSIGNED | FK → fire_reports.id, ON DELETE CASCADE | İlişkili bildirm |
| `type` | ENUM('photo', 'video') | NOT NULL | Medya tipi |
| `url` | VARCHAR(500) | NOT NULL | MinIO dosya URL'i |
| `thumbnail_url` | VARCHAR(500) | NULL | Video için küçük resim (auto-generate veya ilk frame) |
| `original_filename` | VARCHAR(255) | NULL | Orijinal dosya adı |
| `mime_type` | VARCHAR(100) | NOT NULL | MIME tipi (image/jpeg, video/mp4 vb.) |
| `file_size` | INT UNSIGNED | NOT NULL | Dosya boyutu (byte) |
| `duration_seconds` | SMALLINT UNSIGNED | NULL | Video süresi (saniye, yalnızca video için) |
| `sort_order` | TINYINT UNSIGNED | NOT NULL, DEFAULT 0 | Sıralama (gönüllünün eklediği sıra) |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | |

**Index:** `idx_frm_report(fire_report_id)`, `idx_frm_type(type)`

> **Kısıtlamalar:** Bir bildirime maksimum **5 fotoğraf** ve **2 video** eklenebilir. Bu kontrol uygulama katmanında (service layer) yapılır.

---

#### `fire_participants`
Yangına katılan / çağrılan gönüllüler.

| Alan | Tip | Kısıtlama | Açıklama |
|------|-----|-----------|----------|
| `id` | BIGINT UNSIGNED | PK, AUTO_INCREMENT | |
| `fire_id` | BIGINT UNSIGNED | FK → fires.id | |
| `volunteer_id` | BIGINT UNSIGNED | FK → volunteer_profiles.id | |
| `status` | ENUM('called', 'accepted', 'rejected', 'participated', 'no_show') | NOT NULL, DEFAULT 'called' | |
| `called_at` | DATETIME | NOT NULL, DEFAULT NOW() | Çağrı zamanı |
| `responded_at` | DATETIME | NULL | Yanıt zamanı |
| `arrived_at` | DATETIME | NULL | Varış zamanı |
| `left_at` | DATETIME | NULL | Ayrılış zamanı |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | |

**Index:** `UNIQUE idx_fp_fire_vol(fire_id, volunteer_id)`, `idx_fp_status(status)`

---

#### `volunteer_evaluations`
Yangın sonrası gönüllü değerlendirmeleri (admin tarafından).

| Alan | Tip | Kısıtlama | Açıklama |
|------|-----|-----------|----------|
| `id` | BIGINT UNSIGNED | PK, AUTO_INCREMENT | |
| `volunteer_id` | BIGINT UNSIGNED | FK → volunteer_profiles.id | |
| `fire_id` | BIGINT UNSIGNED | FK → fires.id | |
| `evaluator_id` | BIGINT UNSIGNED | FK → users.id | Değerlendiren admin |
| `score` | TINYINT UNSIGNED | NOT NULL, CHECK(1-5) | 1–5 arası puan |
| `comment` | TEXT | NULL | Yorum |
| `is_visible_to_volunteer` | BOOLEAN | NOT NULL, DEFAULT FALSE | Gönüllüye görünür mü |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | |
| `updated_at` | DATETIME | NOT NULL, DEFAULT NOW() ON UPDATE | |

**Index:** `UNIQUE idx_eval_vol_fire(volunteer_id, fire_id, evaluator_id)`, `idx_eval_fire(fire_id)`

---

#### `sos_alerts`
Acil durum (SOS) bildirimleri.

| Alan | Tip | Kısıtlama | Açıklama |
|------|-----|-----------|----------|
| `id` | BIGINT UNSIGNED | PK, AUTO_INCREMENT | |
| `volunteer_id` | BIGINT UNSIGNED | FK → volunteer_profiles.id | |
| `latitude` | DECIMAL(10, 8) | NOT NULL | Anlık konum enlem |
| `longitude` | DECIMAL(11, 8) | NOT NULL | Anlık konum boylam |
| `fire_id` | BIGINT UNSIGNED | FK → fires.id, NULL | İlişkili yangın (varsa) |
| `status` | ENUM('active', 'acknowledged', 'responding', 'resolved', 'false_alarm') | NOT NULL, DEFAULT 'active' | |
| `acknowledged_by` | BIGINT UNSIGNED | FK → users.id, NULL | Bildirimi alan admin |
| `acknowledged_at` | DATETIME | NULL | |
| `resolved_at` | DATETIME | NULL | |
| `resolution_note` | TEXT | NULL | Çözüm notu |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | |
| `updated_at` | DATETIME | NOT NULL, DEFAULT NOW() ON UPDATE | |

**Index:** `idx_sos_volunteer(volunteer_id)`, `idx_sos_status(status)`, `idx_sos_created(created_at DESC)`

---

#### `notifications`
Bildirim tanımları.

| Alan | Tip | Kısıtlama | Açıklama |
|------|-----|-----------|----------|
| `id` | BIGINT UNSIGNED | PK, AUTO_INCREMENT | |
| `type` | ENUM('fire_call', 'info', 'training', 'warning', 'sos_alert') | NOT NULL | Bildirim türü |
| `title` | VARCHAR(300) | NOT NULL | Başlık |
| `body` | TEXT | NOT NULL | İçerik |
| `fire_id` | BIGINT UNSIGNED | FK → fires.id, NULL | İlişkili yangın |
| `target_type` | ENUM('all', 'city', 'district', 'radius', 'specific') | NOT NULL | Hedef kitle türü |
| `target_filter` | JSON | NULL | Filtreleme kriterleri (şehir, yarıçap vb.) |
| `sent_by` | BIGINT UNSIGNED | FK → users.id | Gönderen admin |
| `sent_at` | DATETIME | NULL | Gönderilme zamanı |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | |

**Index:** `idx_notif_type(type)`, `idx_notif_fire(fire_id)`, `idx_notif_sent(sent_at DESC)`

---

#### `notification_recipients`
Bildirim alıcıları.

| Alan | Tip | Kısıtlama | Açıklama |
|------|-----|-----------|----------|
| `id` | BIGINT UNSIGNED | PK, AUTO_INCREMENT | |
| `notification_id` | BIGINT UNSIGNED | FK → notifications.id | |
| `volunteer_id` | BIGINT UNSIGNED | FK → volunteer_profiles.id | |
| `is_read` | BOOLEAN | NOT NULL, DEFAULT FALSE | Okundu mu |
| `read_at` | DATETIME | NULL | Okunma zamanı |
| `push_sent` | BOOLEAN | NOT NULL, DEFAULT FALSE | Push gönderildi mi |
| `push_sent_at` | DATETIME | NULL | |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | |

**Index:** `idx_nr_volunteer(volunteer_id)`, `idx_nr_notif(notification_id)`, `idx_nr_read(volunteer_id, is_read)`

---

#### `blog_posts`
Blog / içerik yazıları.

| Alan | Tip | Kısıtlama | Açıklama |
|------|-----|-----------|----------|
| `id` | BIGINT UNSIGNED | PK, AUTO_INCREMENT | |
| `title` | VARCHAR(500) | NOT NULL | Başlık |
| `slug` | VARCHAR(500) | UNIQUE, NOT NULL | URL-friendly başlık |
| `content` | LONGTEXT | NOT NULL | İçerik (HTML / Markdown) |
| `summary` | TEXT | NULL | Özet |
| `cover_image_url` | VARCHAR(500) | NULL | Kapak görseli |
| `category` | VARCHAR(100) | NULL | Kategori |
| `status` | ENUM('draft', 'published', 'archived') | NOT NULL, DEFAULT 'draft' | |
| `author_id` | BIGINT UNSIGNED | FK → users.id | Yazar (admin) |
| `published_at` | DATETIME | NULL | Yayınlanma zamanı |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | |
| `updated_at` | DATETIME | NOT NULL, DEFAULT NOW() ON UPDATE | |

**Index:** `idx_bp_status(status)`, `idx_bp_slug(slug)`, `idx_bp_published(published_at DESC)`

---

#### `user_sessions`
Aktif oturumlar & refresh token yönetimi.

| Alan | Tip | Kısıtlama | Açıklama |
|------|-----|-----------|----------|
| `id` | BIGINT UNSIGNED | PK, AUTO_INCREMENT | |
| `user_id` | BIGINT UNSIGNED | FK → users.id | |
| `refresh_token` | VARCHAR(500) | NOT NULL | Refresh token |
| `device_info` | VARCHAR(500) | NULL | Cihaz bilgisi |
| `fcm_token` | VARCHAR(500) | NULL | Firebase push notification token |
| `ip_address` | VARCHAR(45) | NULL | |
| `expires_at` | DATETIME | NOT NULL | Token geçerlilik süresi |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | |

**Index:** `idx_us_user(user_id)`, `idx_us_refresh(refresh_token)`, `idx_us_expires(expires_at)`

---

#### `audit_logs`
Kritik işlemlerin kayıt altına alınması.

| Alan | Tip | Kısıtlama | Açıklama |
|------|-----|-----------|----------|
| `id` | BIGINT UNSIGNED | PK, AUTO_INCREMENT | |
| `user_id` | BIGINT UNSIGNED | FK → users.id, NULL | İşlemi yapan |
| `action` | VARCHAR(100) | NOT NULL | İşlem türü (CREATE, UPDATE, DELETE vb.) |
| `entity_type` | VARCHAR(100) | NOT NULL | İlişkili tablo/modül |
| `entity_id` | BIGINT UNSIGNED | NULL | İlişkili kayıt ID |
| `old_value` | JSON | NULL | Önceki değer |
| `new_value` | JSON | NULL | Yeni değer |
| `ip_address` | VARCHAR(45) | NULL | |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | |

**Index:** `idx_al_user(user_id)`, `idx_al_entity(entity_type, entity_id)`, `idx_al_created(created_at DESC)`

---

## 4. Kimlik Doğrulama & Yetkilendirme

### 4.1 Kimlik Doğrulama Akışı (Email / Password + Telefon Doğrulama)

```
Mobile App                    Backend                  Email / SMS Service
    │                            │                            │
    │  1. POST /auth/register    │                            │
    │ ──────────────────────────►│                            │
    │                            │  2. Kullanıcı oluştur      │
    │                            │     (password hash)         │
    │                            │                            │
    │                            │  3. Doğrulama e-postası     │
    │                            │ ──────────────────────────►│ (Email)
    │                            │                            │
    │  4. 201 Created            │                            │
    │ ◄──────────────────────────│                            │
    │                            │                            │
    │  5. POST /auth/phone/      │                            │
    │     send-otp               │                            │
    │ ──────────────────────────►│                            │
    │                            │  6. SMS OTP gönder          │
    │                            │ ──────────────────────────►│ (SMS)
    │  7. OTP kodu döner         │                            │
    │ ◄──────────────────────────│                            │
    │                            │                            │
    │  8. POST /auth/phone/      │                            │
    │     verify-otp             │                            │
    │ ──────────────────────────►│                            │
    │  9. Telefon doğrulandı     │                            │
    │ ◄──────────────────────────│                            │
    │                            │                            │
    │  10. POST /auth/login      │                            │
    │ ──────────────────────────►│                            │
    │                            │  11. Email+password doğrula │
    │                            │  12. JWT (access+refresh)   │
    │ ◄──────────────────────────│                            │
```

**Register Akışı:**
1. Kullanıcı email + password + telefon + temel bilgilerle kayıt olur
2. Parola bcrypt ile hash'lenir ve `users` tablosuna kaydedilir
3. E-posta doğrulama link'i gönderilir
4. Kullanıcı e-postasını doğrulayana kadar `email_verified = false`

**Telefon Doğrulama Akışı:**
1. Kullanıcı `/auth/phone/send-otp` ile SMS doğrulama kodu talep eder
2. 6 haneli rastgele OTP üretilir, 5 dakika geçerli
3. SMS servisi üzerinden kullanıcının telefonuna gönderilir
4. Kullanıcı `/auth/phone/verify-otp` ile kodu girer
5. Doğru kod girilirse `phone_verified = true` olur
6. Yanlış giriş: Maksimum 5 deneme hakkı, aşılırsa 30 dk bekleme süresi
7. OTP tekrar gönderme: Rate limit 1 req / 2 dakika

**Login Akışı:**
1. Kullanıcı email + password ile giriş yapar
2. bcrypt ile parola doğrulanır
3. JWT access token (15dk) + refresh token (30 gün) döner

**Parolamı Unuttum Akışı:**
1. Kullanıcı email adresini girer
2. Parola sıfırlama token'ı üretilir (crypto.randomBytes), 1 saat geçerli
3. Sıfırlama link'i e-posta ile gönderilir
4. Kullanıcı yeni parolasını belirler

### 4.2 JWT Token Yapısı

**Access Token** (kısa ömürlü — 15 dakika):
```json
{
  "sub": "user_id",
  "email": "user@example.com",
  "role": "volunteer | admin | ogm_officer",
  "volunteer_id": 123,
  "iat": 1710000000,
  "exp": 1710000900
}
```

**Refresh Token** (uzun ömürlü — 30 gün):
- `user_sessions` tablosunda saklanır
- Tek kullanımlık (rotation)
- Refresh edildiğinde yeni access + refresh token döner

### 4.3 Admin Girişi

Admin ve OGM görevlileri aynı `/auth/login` endpoint'ini kullanır. `users` tablosundaki `role` alanına göre dönen JWT token'da rol bilgisi yer alır; frontend buna göre admin paneline yönlendirir.

### 4.4 Rol Bazlı Yetkilendirme (RBAC)

| Yetki | volunteer | ogm_officer | admin |
|-------|-----------|-------------|-------|
| Profil görüntüleme (kendi) | ✅ | ✅ | ✅ |
| Profil düzenleme (kendi) | ✅ | ❌ | ❌ |
| Gönüllü listesi görüntüleme | ❌ | ✅ | ✅ |
| Gönüllü başvurusu onay/red | ❌ | ✅ | ✅ |
| Yangın bildirimi gönderme | ✅ | ✅ | ✅ |
| SOS gönderme | ✅ | ❌ | ❌ |
| Yangın yönetimi | ❌ | ❌ | ✅ |
| Gönüllü değerlendirme | ❌ | ✅ | ✅ |
| Bildirim gönderme | ❌ | ❌ | ✅ |
| Eğitim yönetimi | ❌ | ✅ | ✅ |
| Envanter yönetimi | ❌ | ✅ | ✅ |
| Blog yönetimi | ❌ | ❌ | ✅ |
| Dashboard erişimi | ❌ | ✅ | ✅ |
| Admin yetki yönetimi | ❌ | ❌ | ✅ |

---

## 5. API Endpoint Tasarımı

Base URL: `https://api.ogm-gonullu.gov.tr/v1`

Tüm response'lar aşağıdaki standart formattadır:

```json
// Başarılı
{
  "success": true,
  "data": { ... },
  "meta": { "page": 1, "limit": 20, "total": 150 }
}

// Hata
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Geçersiz istek",
    "details": [ { "field": "email", "message": "Geçerli bir e-posta adresi giriniz" } ]
  }
}
```

---

### 5.1 Auth Modülü

#### `POST /auth/register`
Yeni kullanıcı kaydı.

**Request:**
```json
{
  "email": "ahmet@example.com",
  "password": "Secure123!",
  "password_confirmation": "Secure123!",
  "first_name": "Ahmet",
  "last_name": "Yılmaz",
  "phone": "+905559876543",
  "device_info": "iPhone 15, iOS 18.2",
  "fcm_token": "firebase_cloud_messaging_token"
}
```

**Validation Kuralları:**
- `email`: Geçerli email formatı, unique
- `password`: Min 8 karakter, en az 1 büyük harf, 1 küçük harf, 1 rakam
- `phone`: E.164 formatında (`+905xxxxxxxxx`), unique
- `first_name`, `last_name`: Zorunlu, min 2 karakter

**Response (201):**
```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOi...",
    "refresh_token": "dGhpcyBpcyBh...",
    "expires_in": 900,
    "user": {
      "id": 2,
      "email": "ahmet@example.com",
      "phone": "+905559876543",
      "role": "volunteer",
      "status": "pending",
      "email_verified": false,
      "phone_verified": false,
      "is_profile_complete": false
    },
    "message": "Kayıt başarılı. Lütfen e-posta ve telefon numaranızı doğrulayınız."
  }
}
```

**Hata Response (409):**
```json
{
  "success": false,
  "error": {
    "code": "CONFLICT",
    "message": "Bu e-posta adresi veya telefon numarası ile zaten bir hesap bulunmaktadır"
  }
}
```

---

#### `POST /auth/login`
Kullanıcı girişi (tüm roller için).

**Request:**
```json
{
  "email": "ahmet@example.com",
  "password": "Secure123!",
  "device_info": "iPhone 15, iOS 18.2",
  "fcm_token": "firebase_cloud_messaging_token"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOi...",
    "refresh_token": "dGhpcyBpcyBh...",
    "expires_in": 900,
    "user": {
      "id": 1,
      "email": "ahmet@example.com",
      "phone": "+905559876543",
      "role": "volunteer",
      "status": "active",
      "email_verified": true,
      "phone_verified": true,
      "is_profile_complete": true
    }
  }
}
```

**Hata Response (401):**
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "E-posta veya parola hatalı"
  }
}
```

---

#### `POST /auth/forgot-password`
Parola sıfırlama talebi. Rate limit: 3 req/saat/email.

**Request:**
```json
{
  "email": "ahmet@example.com"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Parola sıfırlama bağlantısı e-posta adresinize gönderildi"
  }
}
```

> Not: Güvenlik nedeniyle, kayıtlı olmayan e-posta adresleri için de aynı başarılı yanıt döner.

---

#### `POST /auth/reset-password`
Parola sıfırlama (token ile).

**Request:**
```json
{
  "token": "reset_token_from_email",
  "password": "NewSecure456!",
  "password_confirmation": "NewSecure456!"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Parolanız başarıyla güncellendi. Yeni parolanızla giriş yapabilirsiniz."
  }
}
```

**Hata Response (400):**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_TOKEN",
    "message": "Sıfırlama bağlantısı geçersiz veya süresi dolmuş"
  }
}
```

---

#### `POST /auth/verify-email`
E-posta doğrulama.

**Request:**
```json
{
  "token": "email_verification_token"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "E-posta adresiniz başarıyla doğrulandı"
  }
}
```

---

#### `POST /auth/phone/send-otp`
Telefon numarasına SMS doğrulama kodu gönderir. 🔒 Auth required. Rate limit: 1 req / 2 dakika.

**Request:**
```json
{
  "phone": "+905559876543"
}
```

> Not: `phone` alanı opsiyoneldir. Gönderilmezse kullanıcının kayıtlı telefon numarasına gönderilir. Gönderilirse önce `users.phone` güncellenir (unique kontrolü yapılır).

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Doğrulama kodu telefonunuza gönderildi",
    "phone_masked": "+90555***6543",
    "expires_in_seconds": 300,
    "retry_after_seconds": 120
  }
}
```

**Hata Response (429):**
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT",
    "message": "Lütfen yeni kod göndermek için 2 dakika bekleyiniz",
    "retry_after_seconds": 87
  }
}
```

---

#### `POST /auth/phone/verify-otp`
SMS ile gönderilen OTP kodunu doğrular. 🔒 Auth required. Maksimum 5 deneme hakkı.

**Request:**
```json
{
  "otp_code": "483921"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Telefon numaranız başarıyla doğrulandı",
    "phone_verified": true
  }
}
```

**Hata Response (400) — Yanlış kod:**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_OTP",
    "message": "Doğrulama kodu hatalı",
    "remaining_attempts": 3
  }
}
```

**Hata Response (429) — Deneme hakkı tükendi:**
```json
{
  "success": false,
  "error": {
    "code": "OTP_LOCKED",
    "message": "Çok fazla hatalı deneme. Lütfen 30 dakika sonra yeni kod talep ediniz",
    "retry_after_seconds": 1800
  }
}
```

**Hata Response (410) — Kodun süresi dolmuş:**
```json
{
  "success": false,
  "error": {
    "code": "OTP_EXPIRED",
    "message": "Doğrulama kodunun süresi dolmuş. Lütfen yeni kod talep ediniz"
  }
}
```

---

#### `POST /auth/resend-verification`
E-posta doğrulama link'ini tekrar gönderme. 🔒 Auth required. Rate limit: 3 req/saat.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Doğrulama bağlantısı tekrar gönderildi"
  }
}
```

---

#### `POST /auth/change-password`
Parola değiştirme (oturum açıkken). 🔒 Auth required.

**Request:**
```json
{
  "current_password": "Secure123!",
  "new_password": "NewSecure456!",
  "new_password_confirmation": "NewSecure456!"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Parolanız başarıyla güncellendi"
  }
}
```

---

#### `POST /auth/refresh`
Access token yenilemesi.

**Request:**
```json
{
  "refresh_token": "dGhpcyBpcyBh..."
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "access_token": "new_access_token",
    "refresh_token": "new_refresh_token",
    "expires_in": 900
  }
}
```

---

#### `POST /auth/logout`
Oturumu sonlandırır. 🔒 Auth required.

**Request:**
```json
{
  "refresh_token": "dGhpcyBpcyBh..."
}
```

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "Oturum başarıyla sonlandırıldı" }
}
```

---

### 5.2 Gönüllü Profil Modülü

#### `POST /volunteers/profile`
İlk kayıt sonrası profil tamamlama. 🔒 Auth required (volunteer).

**Request:**
```json
{
  "first_name": "Ahmet",
  "last_name": "Yılmaz",
  "birth_date": "1990-05-15",
  "blood_type": "A+",
  "residence_city": "İzmir",
  "residence_district": "Karşıyaka",
  "residence_address": "Atatürk Mah. No:5",
  "profession": "Mühendis",
  "skills": ["İlk yardım", "Arazi aracı kullanımı", "Telsiz kullanımı"],
  "emergency_contact_name": "Ayşe Yılmaz",
  "emergency_contact_phone": "+905551234567",
  "volunteer_notes": "Hafta sonları müsaitim",
  "phone": "+905559876543"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "volunteer_id": 1,
    "user_id": 2,
    "status": "pending",
    "identity_card_status": "none",
    "message": "Profiliniz oluşturuldu. Başvurunuz inceleniyor."
  }
}
```

---

#### `GET /volunteers/profile`
Kendi profilini görüntüleme. 🔒 Auth required (volunteer).

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "user_id": 2,
    "first_name": "Ahmet",
    "last_name": "Yılmaz",
    "birth_date": "1990-05-15",
    "blood_type": "A+",
    "residence_city": "İzmir",
    "residence_district": "Karşıyaka",
    "profession": "Mühendis",
    "skills": ["İlk yardım", "Arazi aracı kullanımı"],
    "emergency_contact_name": "Ayşe Yılmaz",
    "emergency_contact_phone": "+905551234567",
    "identity_card_status": "issued",
    "identity_card_issued_at": "2026-01-15",
    "status": "active",
    "trainings": [
      {
        "id": 1,
        "title": "Temel Yangın Eğitimi",
        "type": "offline",
        "status": "completed",
        "completion_date": "2026-01-10"
      }
    ],
    "fire_history": {
      "participated_count": 3,
      "called_but_not_participated_count": 1
    },
    "equipment": [
      {
        "id": 1,
        "name": "Baret",
        "issued_date": "2026-01-15",
        "expiry_date": "2028-01-15",
        "status": "active"
      }
    ],
    "average_score": 4.2
  }
}
```

---

#### `PUT /volunteers/profile`
Profil güncelleme. 🔒 Auth required (volunteer).

**Request (partial update):**
```json
{
  "phone": "+905559999999",
  "profession": "Yazılım Mühendisi",
  "skills": ["İlk yardım", "Arazi aracı kullanımı", "Drone kullanımı"],
  "emergency_contact_name": "Fatma Yılmaz",
  "emergency_contact_phone": "+905553334455"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Profil başarıyla güncellendi",
    "updated_fields": ["phone", "profession", "skills", "emergency_contact_name", "emergency_contact_phone"]
  }
}
```

---

#### `PUT /volunteers/profile/location`
Gönüllü konum güncelleme. 🔒 Auth required (volunteer).

**Request:**
```json
{
  "latitude": 38.4192,
  "longitude": 27.1287
}
```

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "Konum güncellendi" }
}
```

---

#### `GET /admin/volunteers`
Gönüllü listesi (admin). 🔒 Auth required (admin, ogm_officer).

**Query Parameters:**
- `page` (int, default: 1)
- `limit` (int, default: 20, max: 100)
- `status` (string: pending | active | suspended | inactive)
- `city` (string)
- `district` (string)
- `identity_card_status` (string: none | issued | revoked)
- `search` (string — ad, soyad, TC ile arama)
- `sort_by` (string: created_at | first_name | last_name | city)
- `sort_order` (string: asc | desc)

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "first_name": "Ahmet",
      "last_name": "Yılmaz",
      "residence_city": "İzmir",
      "phone": "+905559876543",
      "status": "active",
      "identity_card_status": "issued",
      "trainings_completed": 2,
      "fires_participated": 3,
      "average_score": 4.2,
      "created_at": "2026-01-01T10:00:00Z"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1350 }
}
```

---

#### `GET /admin/volunteers/:id`
Gönüllü detay (admin). 🔒 Auth required (admin, ogm_officer).

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "user_id": 2,
    "first_name": "Ahmet",
    "last_name": "Yılmaz",
    "tc_kimlik_no": "123456789**",
    "birth_date": "1990-05-15",
    "blood_type": "A+",
    "residence_city": "İzmir",
    "residence_district": "Karşıyaka",
    "residence_address": "Atatürk Mah. No:5",
    "profession": "Mühendis",
    "skills": ["İlk yardım", "Arazi aracı kullanımı"],
    "criminal_record_clear": true,
    "emergency_contact_name": "Ayşe Yılmaz",
    "emergency_contact_phone": "+905551234567",
    "identity_card_status": "issued",
    "status": "active",
    "is_migrated": false,
    "trainings": [
      {
        "id": 1,
        "title": "Temel Yangın Eğitimi",
        "status": "completed",
        "completion_date": "2026-01-10"
      }
    ],
    "fire_history": [
      {
        "fire_id": 5,
        "fire_title": "İzmir Ödemiş Yangını",
        "status": "participated",
        "called_at": "2026-07-15T08:00:00Z",
        "arrived_at": "2026-07-15T09:30:00Z"
      }
    ],
    "evaluations": [
      {
        "fire_id": 5,
        "fire_title": "İzmir Ödemiş Yangını",
        "score": 5,
        "comment": "Yemek dağıtımında çok destek oldu",
        "evaluator_name": "Mehmet Demir",
        "created_at": "2026-07-20T14:00:00Z"
      }
    ],
    "equipment": [
      {
        "id": 1,
        "equipment_name": "Baret",
        "size": null,
        "serial_number": "BRT-2026-0001",
        "issued_date": "2026-01-15",
        "expiry_date": "2028-01-15",
        "status": "active"
      }
    ]
  }
}
```

---

#### `PATCH /admin/volunteers/:id/status`
Gönüllü durumunu güncelleme (onay/red/askıya alma). 🔒 Auth required (admin, ogm_officer).

**Request:**
```json
{
  "status": "active",
  "reason": "Başvuru onaylandı"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "Gönüllü durumu güncellendi", "new_status": "active" }
}
```

---

#### `POST /admin/volunteers/:id/evaluate`
Gönüllü değerlendirme (yangın sonrası). 🔒 Auth required (admin, ogm_officer).

**Request:**
```json
{
  "fire_id": 5,
  "score": 4,
  "comment": "Lojistik desteğinde aktif rol aldı",
  "is_visible_to_volunteer": false
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": 10,
    "volunteer_id": 1,
    "fire_id": 5,
    "score": 4,
    "comment": "Lojistik desteğinde aktif rol aldı",
    "created_at": "2026-07-20T14:00:00Z"
  }
}
```

---

### 5.3 Eğitim Modülü

#### `GET /trainings`
Eğitim listesi. 🔒 Auth required.

**Query Parameters:**
- `page`, `limit`
- `type` (online | offline)
- `status` (draft | published | ongoing | completed | cancelled)
- `city` (string — offline eğitimler için)

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "title": "Temel Orman Yangını Eğitimi",
      "description": "Gönüllüler için zorunlu temel eğitim",
      "type": "offline",
      "location": "Ankara OGM Eğitim Merkezi",
      "start_date": "2026-04-01T09:00:00Z",
      "end_date": "2026-04-03T17:00:00Z",
      "capacity": 50,
      "enrolled_count": 32,
      "status": "published"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 8 }
}
```

---

#### `GET /trainings/:id`
Eğitim detay. 🔒 Auth required.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "title": "Temel Orman Yangını Eğitimi",
    "description": "Gönüllüler için zorunlu temel eğitim",
    "type": "offline",
    "location": "Ankara OGM Eğitim Merkezi",
    "latitude": 39.9334,
    "longitude": 32.8597,
    "start_date": "2026-04-01T09:00:00Z",
    "end_date": "2026-04-03T17:00:00Z",
    "capacity": 50,
    "enrolled_count": 32,
    "status": "published",
    "is_enrolled": true,
    "enrollment_status": "enrolled"
  }
}
```

---

#### `POST /trainings/:id/enroll`
Eğitime kayıt. 🔒 Auth required (volunteer).

**Response (201):**
```json
{
  "success": true,
  "data": {
    "enrollment_id": 45,
    "training_id": 1,
    "status": "enrolled",
    "enrollment_date": "2026-03-16T12:00:00Z"
  }
}
```

---

#### `DELETE /trainings/:id/enroll`
Eğitim kaydını iptal etme. 🔒 Auth required (volunteer).

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "Eğitim kaydı iptal edildi" }
}
```

---

#### `GET /volunteers/trainings`
Gönüllünün aldığı eğitimler. 🔒 Auth required (volunteer).

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "training_id": 1,
      "title": "Temel Orman Yangını Eğitimi",
      "type": "offline",
      "status": "completed",
      "enrollment_date": "2026-03-01T10:00:00Z",
      "completion_date": "2026-04-03T17:00:00Z",
      "certificate_url": "https://storage.ogm-gonullu.gov.tr/certs/cert_1_1.pdf"
    }
  ]
}
```

---

#### `POST /admin/trainings`
Eğitim oluşturma. 🔒 Auth required (admin, ogm_officer).

**Request:**
```json
{
  "title": "İleri Düzey Yangın Müdahale Eğitimi",
  "description": "Saha deneyimi olan gönüllüler için ileri eğitim",
  "type": "offline",
  "location": "Muğla Orman İşletme Müdürlüğü",
  "latitude": 37.2153,
  "longitude": 28.3636,
  "start_date": "2026-05-10T09:00:00Z",
  "end_date": "2026-05-12T17:00:00Z",
  "capacity": 30
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": 5,
    "title": "İleri Düzey Yangın Müdahale Eğitimi",
    "status": "draft",
    "created_at": "2026-03-16T12:00:00Z"
  }
}
```

---

#### `PUT /admin/trainings/:id`
Eğitim güncelleme. 🔒 Auth required (admin, ogm_officer).

**Request (partial):**
```json
{
  "status": "published",
  "capacity": 40
}
```

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "Eğitim güncellendi" }
}
```

---

#### `PATCH /admin/trainings/:id/volunteers/:volunteerId/status`
Gönüllünün eğitim durumunu güncelleme (tamamlandı/başarısız). 🔒 Auth required (admin, ogm_officer).

**Request:**
```json
{
  "status": "completed",
  "certificate_url": "https://storage.ogm-gonullu.gov.tr/certs/cert_5_12.pdf"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "Gönüllü eğitim durumu güncellendi" }
}
```

---

### 5.4 Envanter & Zimmet Modülü

#### `GET /admin/equipment/types`
Ekipman türleri listesi. 🔒 Auth required (admin, ogm_officer).

**Response (200):**
```json
{
  "success": true,
  "data": [
    { "id": 1, "name": "Baret", "category": "Baş Koruma", "has_size": false, "has_expiry": true },
    { "id": 2, "name": "Yangın Söndürme Botu", "category": "Ayak Koruma", "has_size": true, "has_expiry": true },
    { "id": 3, "name": "Yangın Eldiveni", "category": "El Koruma", "has_size": true, "has_expiry": true },
    { "id": 4, "name": "Koruyucu Tulum", "category": "Vücut Koruma", "has_size": true, "has_expiry": true }
  ]
}
```

---

#### `POST /admin/equipment/types`
Ekipman türü oluşturma. 🔒 Auth required (admin).

**Request:**
```json
{
  "name": "Gaz Maskesi",
  "category": "Solunum Koruma",
  "description": "Duman ve zararlı gazlara karşı koruma",
  "has_size": true,
  "has_expiry": true
}
```

**Response (201):**
```json
{
  "success": true,
  "data": { "id": 5, "name": "Gaz Maskesi", "category": "Solunum Koruma" }
}
```

---

#### `GET /admin/equipment/stock`
Envanter stok durumu. 🔒 Auth required (admin, ogm_officer).

**Query Parameters:**
- `equipment_type_id` (int)
- `size` (string)
- `warehouse_location` (string)
- `expiring_within_days` (int — kaç gün içinde SKT dolacaklar)

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "equipment_type": { "id": 2, "name": "Yangın Söndürme Botu" },
      "size": "42",
      "quantity": 25,
      "warehouse_location": "Ankara Merkez Depo"
    },
    {
      "id": 2,
      "equipment_type": { "id": 2, "name": "Yangın Söndürme Botu" },
      "size": "43",
      "quantity": 18,
      "warehouse_location": "Ankara Merkez Depo"
    }
  ],
  "meta": { "page": 1, "limit": 50, "total": 120 }
}
```

---

#### `PUT /admin/equipment/stock/:id`
Stok güncelleme. 🔒 Auth required (admin, ogm_officer).

**Request:**
```json
{
  "quantity": 30,
  "warehouse_location": "Ankara Merkez Depo"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "Stok güncellendi" }
}
```

---

#### `POST /admin/volunteers/:id/equipment`
Gönüllüye ekipman zimmeti. 🔒 Auth required (admin, ogm_officer).

**Request:**
```json
{
  "equipment_type_id": 2,
  "size": "43",
  "serial_number": "BOT-2026-0042",
  "issued_date": "2026-03-16",
  "expiry_date": "2028-03-16"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": 55,
    "volunteer_id": 1,
    "equipment_name": "Yangın Söndürme Botu",
    "size": "43",
    "serial_number": "BOT-2026-0042",
    "issued_date": "2026-03-16",
    "expiry_date": "2028-03-16",
    "status": "active"
  }
}
```

---

#### `GET /admin/volunteers/:id/equipment`
Gönüllüye zimmetli ekipman listesi. 🔒 Auth required (admin, ogm_officer).

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 55,
      "equipment_name": "Yangın Söndürme Botu",
      "size": "43",
      "serial_number": "BOT-2026-0042",
      "issued_date": "2026-03-16",
      "expiry_date": "2028-03-16",
      "days_until_expiry": 730,
      "status": "active"
    }
  ]
}
```

---

#### `PATCH /admin/equipment/assignments/:id`
Zimmet durumu güncelleme (iade, kayıp vb.). 🔒 Auth required (admin, ogm_officer).

**Request:**
```json
{
  "status": "returned",
  "returned_date": "2026-06-01"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "Zimmet durumu güncellendi" }
}
```

---

#### `GET /volunteers/equipment`
Gönüllünün kendi ekipmanlarını görüntülemesi. 🔒 Auth required (volunteer).

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "equipment_name": "Baret",
      "serial_number": "BRT-2026-0001",
      "issued_date": "2026-01-15",
      "expiry_date": "2028-01-15",
      "days_until_expiry": 670,
      "status": "active"
    }
  ]
}
```

---

#### `GET /admin/equipment/expiring`
SKT'si yaklaşan ekipmanlar raporu. 🔒 Auth required (admin, ogm_officer).

**Query Parameters:**
- `days` (int, default: 90 — kaç gün içinde)

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "assignment_id": 55,
      "volunteer_name": "Ahmet Yılmaz",
      "volunteer_id": 1,
      "equipment_name": "Baret",
      "size": null,
      "serial_number": "BRT-2026-0001",
      "expiry_date": "2026-06-15",
      "days_until_expiry": 91
    }
  ],
  "meta": { "total": 45 }
}
```

---

### 5.5 Yangın Bildirme & Yönetim Modülü

#### `POST /fires/report`
Yangın bildirimi gönderme (gönüllü anasayfasından). Birden fazla fotoğraf ve video eklenebilir. 🔒 Auth required (volunteer).

**Request (multipart/form-data):**
```
photos[]: [binary file]          # Fotoğraf dosyaları (maks 5 adet, her biri maks 10 MB)
photos[]: [binary file]          # jpg, jpeg, png
videos[]: [binary file]          # Video dosyaları (maks 2 adet, her biri maks 50 MB)
                                 # mp4, mov
latitude: 37.8451
longitude: 29.0862
description: "Ormanlık alanda duman gördüm"
```

**Validation Kuralları:**
- `photos[]`: Opsiyonel, maks 5 adet, her biri maks 10 MB, izin verilen: jpg/jpeg/png
- `videos[]`: Opsiyonel, maks 2 adet, her biri maks 50 MB, izin verilen: mp4/mov
- `latitude`, `longitude`: Zorunlu, geçerli koordinat
- `description`: Opsiyonel, maks 2000 karakter
- Toplam dosya sayısı (fotoğraf + video): En az 1 adet zorunlu

**Response (201):**
```json
{
  "success": true,
  "data": {
    "report_id": 12,
    "status": "pending",
    "media": [
      {
        "id": 30,
        "type": "photo",
        "url": "https://api.ogm-gonullu.gov.tr/files/fire-reports/12/a1b2c3.jpg",
        "file_size": 2458000
      },
      {
        "id": 31,
        "type": "photo",
        "url": "https://api.ogm-gonullu.gov.tr/files/fire-reports/12/d4e5f6.jpg",
        "file_size": 3120000
      },
      {
        "id": 32,
        "type": "video",
        "url": "https://api.ogm-gonullu.gov.tr/files/fire-reports/12/g7h8i9.mp4",
        "thumbnail_url": "https://api.ogm-gonullu.gov.tr/files/fire-reports/12/g7h8i9_thumb.jpg",
        "file_size": 15400000,
        "duration_seconds": 18
      }
    ],
    "message": "Yangın bildiriminiz alındı. Yetkililer değerlendirecektir."
  }
}
```

---

#### `GET /admin/fires/reports`
Yangın bildirimleri listesi. 🔒 Auth required (admin, ogm_officer).

**Query Parameters:**
- `page`, `limit`
- `status` (pending | reviewed | confirmed | rejected)

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 12,
      "volunteer": { "id": 1, "first_name": "Ahmet", "last_name": "Yılmaz" },
      "latitude": 37.8451,
      "longitude": 29.0862,
      "description": "Ormanlık alanda duman gördüm",
      "status": "pending",
      "media_count": { "photos": 2, "videos": 1 },
      "media": [
        {
          "id": 30,
          "type": "photo",
          "url": "https://api.ogm-gonullu.gov.tr/files/fire-reports/12/a1b2c3.jpg"
        },
        {
          "id": 31,
          "type": "photo",
          "url": "https://api.ogm-gonullu.gov.tr/files/fire-reports/12/d4e5f6.jpg"
        },
        {
          "id": 32,
          "type": "video",
          "url": "https://api.ogm-gonullu.gov.tr/files/fire-reports/12/g7h8i9.mp4",
          "thumbnail_url": "https://api.ogm-gonullu.gov.tr/files/fire-reports/12/g7h8i9_thumb.jpg",
          "duration_seconds": 18
        }
      ],
      "created_at": "2026-07-15T14:30:00Z"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 5 }
}
```

---

#### `PATCH /admin/fires/reports/:id`
Yangın bildirimini değerlendirme. 🔒 Auth required (admin).

**Request:**
```json
{
  "status": "confirmed",
  "fire_id": 8
}
```

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "Bildirim onaylandı ve yangın kaydına bağlandı" }
}
```

---

#### `POST /admin/fires`
Yangın kaydı oluşturma. 🔒 Auth required (admin).

**Request:**
```json
{
  "title": "Muğla Marmaris Orman Yangını",
  "description": "Marmaris ilçesi ormanlık alanda başlayan yangın",
  "latitude": 36.8509,
  "longitude": 28.2706,
  "city": "Muğla",
  "district": "Marmaris",
  "severity": "high",
  "started_at": "2026-07-15T14:00:00Z"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": 8,
    "title": "Muğla Marmaris Orman Yangını",
    "status": "active",
    "created_at": "2026-07-15T14:35:00Z"
  }
}
```

---

#### `GET /admin/fires`
Yangın listesi. 🔒 Auth required (admin, ogm_officer).

**Query Parameters:**
- `page`, `limit`
- `status` (reported | verified | active | contained | extinguished | false_alarm)
- `city` (string)
- `severity` (low | medium | high | critical)
- `date_from`, `date_to` (ISO date)

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 8,
      "title": "Muğla Marmaris Orman Yangını",
      "city": "Muğla",
      "district": "Marmaris",
      "latitude": 36.8509,
      "longitude": 28.2706,
      "status": "active",
      "severity": "high",
      "started_at": "2026-07-15T14:00:00Z",
      "participants_count": 45,
      "created_at": "2026-07-15T14:35:00Z"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 3 }
}
```

---

#### `GET /admin/fires/:id`
Yangın detay. 🔒 Auth required (admin, ogm_officer).

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 8,
    "title": "Muğla Marmaris Orman Yangını",
    "description": "Marmaris ilçesi ormanlık alanda başlayan yangın",
    "latitude": 36.8509,
    "longitude": 28.2706,
    "city": "Muğla",
    "district": "Marmaris",
    "status": "active",
    "severity": "high",
    "started_at": "2026-07-15T14:00:00Z",
    "contained_at": null,
    "extinguished_at": null,
    "participants": [
      {
        "volunteer_id": 1,
        "first_name": "Ahmet",
        "last_name": "Yılmaz",
        "phone": "+905559876543",
        "status": "participated",
        "called_at": "2026-07-15T15:00:00Z",
        "arrived_at": "2026-07-15T16:30:00Z"
      }
    ],
    "reports": [
      {
        "id": 12,
        "volunteer_name": "Ahmet Yılmaz",
        "media_count": { "photos": 2, "videos": 1 },
        "media": [
          { "id": 30, "type": "photo", "url": "https://api.ogm-gonullu.gov.tr/files/fire-reports/12/a1b2c3.jpg" },
          { "id": 31, "type": "photo", "url": "https://api.ogm-gonullu.gov.tr/files/fire-reports/12/d4e5f6.jpg" },
          { "id": 32, "type": "video", "url": "https://api.ogm-gonullu.gov.tr/files/fire-reports/12/g7h8i9.mp4", "thumbnail_url": "https://api.ogm-gonullu.gov.tr/files/fire-reports/12/g7h8i9_thumb.jpg" }
        ],
        "created_at": "2026-07-15T14:30:00Z"
      }
    ],
    "nearby_volunteers_count": 120,
    "created_by_name": "Mehmet Demir"
  }
}
```

---

#### `PUT /admin/fires/:id`
Yangın kaydı güncelleme. 🔒 Auth required (admin).

**Request:**
```json
{
  "status": "contained",
  "contained_at": "2026-07-17T08:00:00Z"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "Yangın kaydı güncellendi" }
}
```

---

#### `POST /admin/fires/:id/call-volunteers`
Yangın için gönüllü çağrısı yapma. 🔒 Auth required (admin).

**Request:**
```json
{
  "target_type": "radius",
  "target_filter": {
    "latitude": 36.8509,
    "longitude": 28.2706,
    "radius_km": 50
  },
  "message": "Marmaris orman yangını için acil gönüllü desteği gerekmektedir. Lütfen uygulamadaki çağrıyı kontrol ediniz."
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "fire_id": 8,
    "volunteers_called": 120,
    "notification_id": 55,
    "message": "120 gönüllüye çağrı bildirimi gönderildi"
  }
}
```

---

#### `POST /fires/:fireId/respond`
Gönüllünün yangın çağrısına yanıt vermesi. 🔒 Auth required (volunteer).

**Request:**
```json
{
  "response": "accepted"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "Yanıtınız kaydedildi. Lütfen belirtilen konuma doğru yola çıkınız." }
}
```

---

#### `GET /admin/fires/:id/volunteers`
Yangına çağrılan/katılan gönüllü listesi. 🔒 Auth required (admin, ogm_officer).

**Query Parameters:**
- `status` (called | accepted | rejected | participated | no_show)

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "volunteer_id": 1,
      "first_name": "Ahmet",
      "last_name": "Yılmaz",
      "phone": "+905559876543",
      "residence_city": "İzmir",
      "status": "accepted",
      "called_at": "2026-07-15T15:00:00Z",
      "responded_at": "2026-07-15T15:05:00Z",
      "latitude": 37.1234,
      "longitude": 28.5678,
      "distance_km": 42.5
    }
  ],
  "meta": { "total": 120 }
}
```

---

### 5.6 SOS (Acil Durum) Modülü

#### `POST /sos`
SOS bildirimi gönderme. 🔒 Auth required (volunteer).

**Request:**
```json
{
  "latitude": 36.8501,
  "longitude": 28.2710,
  "fire_id": 8
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "sos_id": 3,
    "status": "active",
    "message": "Acil durum bildiriminiz alındı. Yardım ekibi yönlendirilmektedir."
  }
}
```

---

#### `GET /admin/sos`
Aktif SOS bildirimleri listesi. 🔒 Auth required (admin, ogm_officer).

**Query Parameters:**
- `status` (active | acknowledged | responding | resolved | false_alarm)

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 3,
      "volunteer": {
        "id": 1,
        "first_name": "Ahmet",
        "last_name": "Yılmaz",
        "phone": "+905559876543",
        "blood_type": "A+",
        "emergency_contact_name": "Ayşe Yılmaz",
        "emergency_contact_phone": "+905551234567"
      },
      "latitude": 36.8501,
      "longitude": 28.2710,
      "fire": { "id": 8, "title": "Muğla Marmaris Orman Yangını" },
      "status": "active",
      "created_at": "2026-07-16T11:30:00Z"
    }
  ]
}
```

---

#### `PATCH /admin/sos/:id`
SOS bildirim durumu güncelleme. 🔒 Auth required (admin, ogm_officer).

**Request:**
```json
{
  "status": "responding",
  "resolution_note": "Kurtarma ekibi yola çıktı"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "SOS durumu güncellendi" }
}
```

---

### 5.7 Bildirim Modülü

#### `POST /admin/notifications`
Bildirim oluşturma ve gönderme. 🔒 Auth required (admin).

**Request:**
```json
{
  "type": "info",
  "title": "Eğitim Duyurusu",
  "body": "Muğla bölgesinde yeni bir yangın eğitimi planlanmıştır. Detaylar için eğitimler bölümünü kontrol ediniz.",
  "target_type": "city",
  "target_filter": {
    "city": "Muğla"
  }
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "notification_id": 60,
    "recipients_count": 250,
    "sent_at": "2026-03-16T10:00:00Z"
  }
}
```

---

#### `GET /admin/notifications`
Gönderilmiş bildirimler listesi. 🔒 Auth required (admin).

**Query Parameters:**
- `page`, `limit`
- `type` (fire_call | info | training | warning | sos_alert)

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 60,
      "type": "info",
      "title": "Eğitim Duyurusu",
      "body": "Muğla bölgesinde yeni bir yangın eğitimi planlanmıştır...",
      "target_type": "city",
      "recipients_count": 250,
      "read_count": 180,
      "sent_by_name": "Mehmet Demir",
      "sent_at": "2026-03-16T10:00:00Z"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 35 }
}
```

---

#### `GET /notifications`
Gönüllünün bildirimleri. 🔒 Auth required (volunteer).

**Query Parameters:**
- `page`, `limit`
- `is_read` (boolean)

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 150,
      "notification_id": 60,
      "type": "info",
      "title": "Eğitim Duyurusu",
      "body": "Muğla bölgesinde yeni bir yangın eğitimi planlanmıştır...",
      "is_read": false,
      "created_at": "2026-03-16T10:00:00Z"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 12, "unread_count": 3 }
}
```

---

#### `PATCH /notifications/:id/read`
Bildirimi okundu olarak işaretleme. 🔒 Auth required (volunteer).

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "Bildirim okundu olarak işaretlendi" }
}
```

---

#### `POST /notifications/read-all`
Tüm bildirimleri okundu olarak işaretleme. 🔒 Auth required (volunteer).

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "Tüm bildirimler okundu olarak işaretlendi" }
}
```

---

### 5.8 Blog (İçerik) Modülü

#### `GET /blog/posts`
Blog yazıları listesi (public). 🔒 Auth required.

**Query Parameters:**
- `page`, `limit`
- `category` (string)
- `search` (string — başlık/içerik arama)

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "title": "Orman Yangınları Hakkında Doğru Bilinen Yanlışlar",
      "slug": "orman-yanginlari-hakkinda-dogru-bilinen-yanlislar",
      "summary": "Orman yangınlarıyla ilgili toplumda yaygın olan bazı yanlış bilgileri ele alıyoruz.",
      "cover_image_url": "https://storage.ogm-gonullu.gov.tr/blog/cover_1.jpg",
      "category": "Bilinçlendirme",
      "author_name": "OGM Editör",
      "published_at": "2026-03-01T09:00:00Z"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 5 }
}
```

---

#### `GET /blog/posts/:slug`
Blog yazısı detay. 🔒 Auth required.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "title": "Orman Yangınları Hakkında Doğru Bilinen Yanlışlar",
    "slug": "orman-yanginlari-hakkinda-dogru-bilinen-yanlislar",
    "content": "<p>Orman yangınlarıyla ilgili...</p>",
    "summary": "Orman yangınlarıyla ilgili toplumda yaygın olan bazı yanlış bilgileri ele alıyoruz.",
    "cover_image_url": "https://storage.ogm-gonullu.gov.tr/blog/cover_1.jpg",
    "category": "Bilinçlendirme",
    "author_name": "OGM Editör",
    "published_at": "2026-03-01T09:00:00Z"
  }
}
```

---

#### `POST /admin/blog/posts`
Blog yazısı oluşturma. 🔒 Auth required (admin).

**Request:**
```json
{
  "title": "Bahçe Temizliği ve Yangın Önleme",
  "content": "<p>Yazlık evlerin bahçelerinde...</p>",
  "summary": "Bahçe bakımının yangın önlemedeki rolü",
  "category": "Önlem",
  "cover_image_url": "https://storage.ogm-gonullu.gov.tr/blog/cover_6.jpg",
  "status": "published"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": 6,
    "slug": "bahce-temizligi-ve-yangin-onleme",
    "status": "published",
    "published_at": "2026-03-16T12:00:00Z"
  }
}
```

---

#### `PUT /admin/blog/posts/:id`
Blog yazısı güncelleme. 🔒 Auth required (admin).

**Request (partial):**
```json
{
  "title": "Bahçe Temizliği ve Yangın Önleme Rehberi",
  "status": "published"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "Blog yazısı güncellendi" }
}
```

---

#### `DELETE /admin/blog/posts/:id`
Blog yazısı silme. 🔒 Auth required (admin).

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "Blog yazısı silindi" }
}
```

---

### 5.9 Admin Dashboard Modülü

#### `GET /admin/dashboard/summary`
Dashboard özet verileri. 🔒 Auth required (admin, ogm_officer).

**Response (200):**
```json
{
  "success": true,
  "data": {
    "volunteers": {
      "total": 137250,
      "active": 125000,
      "pending": 1200,
      "suspended": 50,
      "new_this_month": 350
    },
    "fires": {
      "active": 2,
      "this_year_total": 45,
      "this_month_total": 3
    },
    "trainings": {
      "upcoming": 5,
      "ongoing": 1,
      "completed_this_year": 12
    },
    "equipment": {
      "total_assigned": 85000,
      "expiring_within_90_days": 1200
    },
    "sos": {
      "active": 0,
      "today": 0
    },
    "fire_reports": {
      "pending_review": 3
    }
  }
}
```

---

#### `GET /admin/dashboard/active-fires`
Aktif yangınlar harita verisi. 🔒 Auth required (admin, ogm_officer).

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 8,
      "title": "Muğla Marmaris Orman Yangını",
      "latitude": 36.8509,
      "longitude": 28.2706,
      "severity": "high",
      "status": "active",
      "participants_count": 45,
      "started_at": "2026-07-15T14:00:00Z"
    }
  ]
}
```

---

#### `GET /admin/dashboard/volunteers-map`
Yangın konumuna göre yakın gönüllüler. 🔒 Auth required (admin).

**Query Parameters:**
- `latitude` (required)
- `longitude` (required)
- `radius_km` (int, default: 50)
- `status` (default: active)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "center": { "latitude": 36.8509, "longitude": 28.2706 },
    "radius_km": 50,
    "volunteers": [
      {
        "id": 1,
        "first_name": "Ahmet",
        "last_name": "Yılmaz",
        "latitude": 37.1234,
        "longitude": 28.5678,
        "distance_km": 32.5,
        "identity_card_status": "issued",
        "trainings_completed": 2
      }
    ],
    "total": 120
  }
}
```

---

### 5.10 Admin Yönetimi

#### `POST /admin/users`
Admin / OGM Görevlisi oluşturma. 🔒 Auth required (admin — superadmin yetkisi).

**Request:**
```json
{
  "tc_kimlik_no": "98765432109",
  "first_name": "Ali",
  "last_name": "Kaya",
  "title": "Bölge Yangın Müdürü",
  "department": "Muğla Orman Bölge Müdürlüğü",
  "role": "ogm_officer",
  "password": "secure_password_123",
  "permissions": ["volunteer_manage", "training_manage", "equipment_manage"]
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": 105,
    "role": "ogm_officer",
    "first_name": "Ali",
    "last_name": "Kaya"
  }
}
```

---

#### `GET /admin/users`
Admin kullanıcı listesi. 🔒 Auth required (admin — superadmin yetkisi).

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 100,
      "first_name": "Mehmet",
      "last_name": "Demir",
      "role": "admin",
      "title": "OGM Merkez Müdürü",
      "department": "Ankara Merkez",
      "status": "active",
      "last_login_at": "2026-03-16T09:00:00Z"
    }
  ]
}
```

---

#### `PUT /admin/users/:id`
Admin kullanıcı güncelleme. 🔒 Auth required (admin — superadmin yetkisi).

**Request:**
```json
{
  "title": "Bölge Müdür Yardımcısı",
  "permissions": ["volunteer_manage", "training_manage"]
}
```

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "Kullanıcı güncellendi" }
}
```

---

## 6. 3rd Party Entegrasyonlar

> **On-Premise Prensip:** Tüm temel servisler kurumun kendi sunucularında çalışır. Dış bağımlılıklar yalnızca push notification (FCM) ve e-posta gönderimi (SMTP) ile sınırlıdır; bu ikisi outbound bağlantı gerektirir.

### 6.1 MinIO — Object Storage (On-Premise)

| Özellik | Detay |
|---------|-------|
| **Amaç** | Fotoğraf ve dosya depolama (yangın fotoğrafları, profil fotoğrafları, sertifika PDF'leri, blog görselleri) |
| **Dağıtım** | Docker container, aynı sunucu veya ayrı storage sunucu |
| **SDK** | `@aws-sdk/client-s3` (MinIO, S3-uyumlu API sağlar) |
| **Bucket Yapısı** | `fire-reports/`, `profile-photos/`, `certificates/`, `blog/` |
| **Erişim** | Pre-signed URL ile süreli erişim (Nginx üzerinden proxy) |
| **Yedekleme** | Günlük cronjob ile `mc mirror` komutuyla yedek diske kopyalama |
| **Dashboard** | MinIO Console (`http://minio-host:9001`) ile görsel yönetim |

### 6.2 E-posta Gönderim Servisi

| Özellik | Detay |
|---------|-------|
| **Amaç** | E-posta doğrulama, parola sıfırlama, bilgilendirme e-postaları |
| **Servis** | Nodemailer + Kurumsal SMTP sunucusu (OGM'nin mevcut mail altyapısı) |
| **SDK** | `nodemailer` (Node.js) |
| **Şablonlar** | E-posta doğrulama, parola sıfırlama, hoş geldiniz |
| **Rate Limit** | Doğrulama: 3/saat, Sıfırlama: 3/saat |
| **Not** | Kurumsal SMTP yoksa, aynı sunucuya Postfix kurularak lokal SMTP sağlanabilir |

### 6.3 SMS Gönderim Servisi (Telefon Doğrulama)

| Özellik | Detay |
|---------|-------|
| **Amaç** | Telefon numarası doğrulama (OTP kodu gönderimi) |
| **Servis Seçenekleri** | **Netgsm**, **İleti Merkezi**, **Mutlucell**, veya **Turkcell Kurumsal SMS** (kurumun mevcut anlaşmasına göre) |
| **SDK** | İlgili sağlayıcının REST API'si üzerinden HTTP client (`axios`) |
| **OTP Formatı** | 6 haneli rastgele sayısal kod |
| **Geçerlilik** | 5 dakika |
| **Rate Limit** | 1 SMS / 2 dakika / kullanıcı, günlük maks 10 SMS / kullanıcı |
| **Güvenlik** | Maks 5 yanlış deneme → 30 dk kilitleme; OTP kodu veritabanında hash'lenmeden saklanır (kısa ömürlü) |
| **Ağ Gereksinimi** | Outbound HTTPS — SMS sağlayıcısının API endpoint'ine erişim |
| **Fallback** | SMS gönderilemezse hata loglanır, kullanıcıya "Tekrar deneyin" mesajı döner |

**SMS Mesaj Şablonu:**
```
OGM Gönüllü Sistemi doğrulama kodunuz: 483921. Bu kod 5 dakika geçerlidir. Kimseyle paylaşmayınız.
```

### 6.4 Firebase Cloud Messaging — FCM (Dış Servis)

| Özellik | Detay |
|---------|-------|
| **Amaç** | Push notification gönderimi (yangın çağrısı, bilgilendirme, eğitim duyurusu) |
| **SDK** | `firebase-admin` (Node.js) |
| **Kullanım** | Topic-based (şehir bazlı) + individual token-based |
| **Maliyet** | Ücretsiz |
| **Ağ Gereksinimi** | Sunucudan `fcm.googleapis.com:443` adresine **outbound HTTPS** erişimi gereklidir |
| **Firewall Kuralı** | Outbound: `fcm.googleapis.com`, `oauth2.googleapis.com` (443/TCP) |

### 6.5 Nominatim — Reverse Geocoding (On-Premise, Opsiyonel)

| Özellik | Detay |
|---------|-------|
| **Amaç** | Koordinattan il/ilçe bilgisi çıkarma |
| **Dağıtım** | Docker container (`mediagis/nominatim`) — Türkiye OSM verileri ile |
| **Veri Boyutu** | Türkiye extract'i ~2 GB (import sonrası ~10 GB disk) |
| **Alternatif** | Statik il/ilçe sınır verileri (GeoJSON) ile MySQL spatial query — daha hafif |
| **Not** | Dış internet erişimi isteniyorsa OpenStreetMap public Nominatim API de kullanılabilir |

### 6.6 Harita & Konum Servisleri

| Özellik | Detay |
|---------|-------|
| **Mesafe Hesaplama** | MySQL `ST_Distance_Sphere()` fonksiyonu ile veritabanı seviyesinde |
| **Reverse Geocoding** | On-premise Nominatim (6.4) veya statik GeoJSON lookup |
| **Harita Gösterimi** | Frontend tarafında (React Native Maps / Leaflet) — backend'den koordinat verilir |
| **Tile Server** | Opsiyonel: On-premise tile server (`tileserver-gl`) ile internet bağımsız harita |

### 6.7 E-Devlet Entegrasyonu (Gelecek Faz)

| Özellik | Detay |
|---------|-------|
| **Amaç** | Vatandaş kimlik doğrulama, kişisel bilgi çekme (TC, ad, soyad, adres, sabıka durumu) |
| **Protokol** | OAuth 2.0 Authorization Code Flow |
| **Durum** | MVP kapsamı dışında; Faz 2'de entegrasyon planlanacak |
| **Başvuru** | OGM kurumsal başvurusu ile entegrasyon izni alınması gerekir |

### 6.8 ORBİS Sistemi (Gelecek Faz)

| Özellik | Detay |
|---------|-------|
| **Amaç** | OGM'nin mevcut kayıt sistemi ile entegrasyon |
| **Kapsam** | Gönüllü kimlik kartı, KKD (Kişisel Koruyucu Donanım) kayıtları |
| **Durum** | MVP'de manuel veri girişi; Faz 2'de API entegrasyonu planlanacak |

### 6.9 Meteorolojik Erken Uyarı Sistemi (Gelecek Faz)

| Özellik | Detay |
|---------|-------|
| **Amaç** | Yangın risk oranı %80 üzerinde olduğunda admin paneline uyarı düşürme |
| **Kaynak** | MGM (Meteoroloji Genel Müdürlüğü) API'si |
| **Kapsam** | MVP kapsamı dışında; Faz 2'de entegrasyon planlanacak |

---

## 7. Bildirim Altyapısı

### 7.1 Push Notification Akışı

```
Admin Panel                Backend              FCM               Mobile App
    │                         │                  │                    │
    │  1. POST /notifications │                  │                    │
    │ ───────────────────────►│                  │                    │
    │                         │  2. Hedef gönüllü│                    │
    │                         │     listesi çek  │                    │
    │                         │                  │                    │
    │                         │  3. FCM'e gönder │                    │
    │                         │ ────────────────►│                    │
    │                         │                  │  4. Push bildirim  │
    │                         │                  │ ──────────────────►│
    │                         │                  │                    │
    │  5. Sonuç raporu        │                  │                    │
    │ ◄───────────────────────│                  │                    │
```

### 7.2 Bildirim Hedefleme Stratejileri

| Hedef Türü | Filtre | Açıklama |
|------------|--------|----------|
| `all` | — | Tüm aktif gönüllülere |
| `city` | `{ "city": "Muğla" }` | Belirli ildeki gönüllülere |
| `district` | `{ "city": "Muğla", "district": "Marmaris" }` | İl + ilçe bazlı |
| `radius` | `{ "latitude": 36.85, "longitude": 28.27, "radius_km": 50 }` | Konum + yarıçap |
| `specific` | `{ "volunteer_ids": [1, 5, 12] }` | Belirli gönüllülere |

### 7.3 In-App Bildirim

Yangın bildirimleri ve SOS uyarıları admin panelinde in-app bildirim olarak da gösterilir. Admin paneli WebSocket (Socket.IO) ile real-time bildirim alır:

```
Backend ──── Socket.IO ────► Admin Panel (Browser)
```

**Event'ler:**
- `fire_report:new` — Yeni yangın bildirimi
- `sos:new` — Yeni SOS bildirimi
- `sos:update` — SOS durum güncellemesi
- `fire:update` — Yangın durum güncellemesi

---

## 8. Dosya Yönetimi

### 8.1 Upload Akışı

**Tekli Dosya (profil fotoğrafı, sertifika, blog görseli):**
1. Client, dosyayı `multipart/form-data` ile backend'e gönderir
2. Backend `multer` ile dosyayı alır, boyut ve MIME type kontrolü yapar
3. Dosya on-premise MinIO'ya upload edilir (`@aws-sdk/client-s3` ile)
4. Dosya URL'i veritabanına kaydedilir
5. Nginx, MinIO'ya reverse proxy yaparak dosya erişimini sağlar

**Çoklu Dosya — Yangın Bildirimi (fotoğraf + video):**
1. Client, `multipart/form-data` ile birden fazla dosya gönderir (`photos[]`, `videos[]`)
2. Backend `multer.fields()` ile dosyaları alır; adet, boyut ve format kontrolleri yapılır
3. Her dosya UUID ile isimlendirilip MinIO'ya paralel upload edilir
4. Video dosyaları için thumbnail oluşturulur (`ffmpeg` ile ilk frame — opsiyonel)
5. Her dosya için `fire_report_media` tablosuna kayıt eklenir (type, url, mime_type, file_size)
6. Transaction ile `fire_reports` + `fire_report_media` kayıtları atomik oluşturulur

### 8.2 Dosya Kısıtlamaları

| Dosya Türü | Max Boyut | Max Adet | İzin Verilen Formatlar |
|------------|-----------|----------|----------------------|
| Profil fotoğrafı | 5 MB | 1 | jpg, jpeg, png |
| Yangın bildirimi — fotoğraf | 10 MB / adet | 5 | jpg, jpeg, png |
| Yangın bildirimi — video | 50 MB / adet | 2 | mp4, mov |
| Blog kapak görseli | 5 MB | 1 | jpg, jpeg, png, webp |
| Sertifika | 10 MB | 1 | pdf |

### 8.3 MinIO Bucket Yapısı

```
ogm-gonullu-storage/                                  # MinIO bucket
├── profile-photos/{volunteer_id}/{uuid}.jpg
├── fire-reports/{report_id}/photos/{uuid}.jpg        # Yangın bildirimi fotoğrafları
├── fire-reports/{report_id}/videos/{uuid}.mp4        # Yangın bildirimi videoları
├── fire-reports/{report_id}/thumbnails/{uuid}.jpg    # Video thumbnail'ları
├── certificates/{volunteer_id}/{training_id}.pdf
└── blog/{post_id}/{uuid}.jpg
```

> **Erişim:** MinIO Console `http://<sunucu-ip>:9001` adresinden dosya yönetimi yapılabilir. Dış erişim Nginx üzerinden `https://api.ogm-gonullu.gov.tr/files/*` olarak proxy edilir.

---

## 9. Hata Yönetimi & Loglama

### 9.1 Hata Kodları

| HTTP Status | Kod | Açıklama |
|-------------|-----|----------|
| 400 | `VALIDATION_ERROR` | Request validation hatası |
| 401 | `UNAUTHORIZED` | Kimlik doğrulama hatası |
| 403 | `FORBIDDEN` | Yetki hatası |
| 404 | `NOT_FOUND` | Kaynak bulunamadı |
| 409 | `CONFLICT` | Çakışma (duplicate kayıt vb.) |
| 422 | `BUSINESS_ERROR` | İş kuralı hatası |
| 429 | `RATE_LIMIT` | Rate limit aşıldı |
| 500 | `INTERNAL_ERROR` | Sunucu hatası |

### 9.2 Loglama

Winston ile yapısal JSON loglama:

```json
{
  "level": "info",
  "timestamp": "2026-03-16T12:00:00Z",
  "service": "ogm-gonullu-api",
  "module": "fires",
  "action": "fire_created",
  "user_id": 100,
  "fire_id": 8,
  "message": "New fire record created",
  "ip": "192.168.1.1"
}
```

**Log Seviyeleri:**
- `error` — Kritik hatalar (DB bağlantı kaybı, 3rd party API hatası)
- `warn` — Uyarılar (rate limit yaklaşımı, geçersiz token)
- `info` — Önemli iş olayları (yangın oluşturma, SOS, bildirim gönderme)
- `debug` — Geliştirme amaçlı detaylı loglar

**On-Premise Log Yönetimi:**
- Loglar Docker volume üzerinden host dosya sistemine yazılır (`/opt/ogm-gonullu/logs/`)
- Winston daily-rotate-file transport ile günlük rotasyon
- 90 gün retention, eski loglar otomatik sıkıştırılır (gzip)
- Opsiyonel: Prometheus + Grafana ile metrik dashboard (CPU, RAM, istek/saniye, hata oranı)

---

## 10. Güvenlik

### 10.1 Genel Önlemler

| Önlem | Uygulama |
|-------|----------|
| HTTPS | Tüm iletişim TLS 1.2+ üzerinden |
| CORS | Yalnızca izin verilen origin'ler (admin panel domain, mobile deep link) |
| Helmet | HTTP güvenlik header'ları (X-Frame-Options, CSP, HSTS vb.) |
| Rate Limiting | IP bazlı — genel: 100 req/dk, login: 10 req/dk, register: 5 req/dk, forgot-password: 3 req/saat, send-otp: 1 req/2dk, verify-otp: 5 deneme/kod, SOS: 5 req/dk |
| Input Validation | Joi ile tüm request body/query/params doğrulanır |
| SQL Injection | Knex.js parameterized queries |
| XSS | Blog içeriği için HTML sanitize (DOMPurify server-side) |
| Dosya Upload | MIME type kontrolü, dosya boyutu limiti, UUID ile isimlendirme |
| Audit Log | Kritik işlemler (durum değişiklikleri, zimmet, silme) loglanır |

### 10.2 On-Premise Güvenlik Katmanları

| Katman | Uygulama |
|--------|----------|
| Ağ İzolasyonu | Docker internal network — DB, Redis, MinIO dışarıya kapalı (yalnızca 127.0.0.1) |
| Firewall | Sadece 80/443 inbound açık; outbound sadece FCM + SMTP |
| SSL/TLS | Kurumsal CA sertifikası, Nginx SSL termination, TLS 1.2+ zorunlu |
| Container Güvenliği | Non-root user, read-only filesystem (mümkün olduğunca), resource limits |
| Log Merkezi | Tüm loglar host dosya sistemine yazılır, SIEM entegrasyonu mümkün |
| Yedekleme | Şifreli yedekleme, ayrı depolama alanı, 30 gün retention |

### 10.3 Kişisel Veri Koruma (KVKK)

| Gereksinim | Uygulama |
|------------|----------|
| Aydınlatma Metni | İlk kayıt sırasında KVKK aydınlatma metni onayı |
| Açık Rıza | Konum bilgisi paylaşımı için açık rıza alınması |
| Veri Minimizasyonu | Yalnızca operasyonel olarak gerekli veriler toplanır |
| TC Kimlik Maskeleme | API response'larda TC kimlik numarası maskelenir (123456789**) |
| Erişim Kontrolü | Rol bazlı veri erişim kısıtlaması |
| Veri Saklama Süresi | Pasif gönüllü verileri belirli süre sonra anonimleştirilir |

---

## 11. Deployment & DevOps (On-Premise)

> **Prensip:** Tüm bileşenler Docker container olarak paketlenir ve `docker-compose` ile tek komutla ayağa kaldırılır. Bulut bağımlılığı yoktur. Sunucu kurulumu için yalnızca Docker Engine + Docker Compose gereklidir.

### 11.1 Ortamlar

| Ortam | Amaç | Dağıtım |
|-------|------|---------|
| `development` | Yerel geliştirme | `docker-compose.dev.yml` (hot-reload, debug) |
| `staging` | Test ve demo | Aynı sunucuda ayrı port veya ayrı VM |
| `production` | Canlı ortam | `docker-compose.yml` (optimized, restart policy) |

### 11.2 Docker Compose Yapısı

```yaml
# docker-compose.yml (Production)
version: "3.9"
services:

  nginx:
    image: nginx:1.25-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./docker/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./docker/nginx/ssl:/etc/nginx/ssl:ro
      - admin-panel-build:/usr/share/nginx/html:ro  # Admin panel static files
    depends_on:
      - backend
    restart: always

  backend:
    build:
      context: .
      dockerfile: docker/Dockerfile
    env_file: .env
    expose:
      - "3000"
    volumes:
      - ./logs:/app/logs             # Log dosyaları host'a yazılır
      - ./firebase-sa.json:/app/firebase-sa.json:ro
    depends_on:
      mysql:
        condition: service_healthy
      redis:
        condition: service_healthy
      minio:
        condition: service_started
    deploy:
      replicas: 2                    # PM2 cluster yerine compose replicas
    restart: always

  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
      MYSQL_DATABASE: ogm_gonullu
      MYSQL_USER: ${DB_USER}
      MYSQL_PASSWORD: ${DB_PASSWORD}
    volumes:
      - mysql-data:/var/lib/mysql
      - ./docker/mysql/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
      - ./backups/mysql:/backups     # Yedekleme dizini
    ports:
      - "127.0.0.1:3306:3306"       # Sadece localhost'tan erişim
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      retries: 5
    restart: always

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD} --appendonly yes
    volumes:
      - redis-data:/data
    ports:
      - "127.0.0.1:6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      retries: 5
    restart: always

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${MINIO_SECRET_KEY}
    volumes:
      - minio-data:/data
      - ./backups/minio:/backups
    ports:
      - "127.0.0.1:9000:9000"       # S3 API — Nginx üzerinden proxy
      - "127.0.0.1:9001:9001"       # MinIO Console (admin erişimi)
    restart: always

volumes:
  mysql-data:
  redis-data:
  minio-data:
  admin-panel-build:
```

### 11.3 Dockerfile (Backend)

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY src/ ./src/
COPY migrations/ ./migrations/
COPY seeds/ ./seeds/
COPY knexfile.js ./

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=builder /app ./
RUN mkdir -p /app/logs

# PM2 global install (cluster mode için)
RUN npm install -g pm2

EXPOSE 3000
USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pm2-runtime", "src/server.js", "-i", "max"]
```

### 11.4 Nginx Konfigürasyonu (Özet)

```nginx
# /docker/nginx/nginx.conf

upstream backend {
    least_conn;
    server backend:3000;
}

server {
    listen 80;
    server_name api.ogm-gonullu.gov.tr;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.ogm-gonullu.gov.tr;

    ssl_certificate     /etc/nginx/ssl/server.crt;
    ssl_certificate_key /etc/nginx/ssl/server.key;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # API proxy
    location /v1/ {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket desteği (Socket.IO için)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # MinIO dosya proxy (pre-signed URL'ler buradan servis edilir)
    location /files/ {
        proxy_pass http://minio:9000/;
        proxy_set_header Host $host;
    }

    # Admin Panel (static)
    location / {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /index.html;
    }
}
```

### 11.5 Ortam Değişkenleri (.env)

```env
# ── Server ──────────────────────────────────────
NODE_ENV=production
PORT=3000

# ── Database (MySQL — on-premise container) ─────
DB_HOST=mysql
DB_PORT=3306
DB_NAME=ogm_gonullu
DB_USER=ogm_app
DB_PASSWORD=***
DB_ROOT_PASSWORD=***

# ── Redis (on-premise container) ────────────────
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=***

# ── JWT ─────────────────────────────────────────
JWT_ACCESS_SECRET=***
JWT_REFRESH_SECRET=***
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d

# ── MinIO (on-premise container) ────────────────
MINIO_ENDPOINT=http://minio:9000
MINIO_ACCESS_KEY=ogm_minio_admin
MINIO_SECRET_KEY=***
MINIO_BUCKET=ogm-gonullu-storage
MINIO_USE_SSL=false
MINIO_PUBLIC_URL=https://api.ogm-gonullu.gov.tr/files

# ── Email (Kurumsal SMTP) ──────────────────────
SMTP_HOST=mail.ogm.gov.tr
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=gonullu-sistem@ogm.gov.tr
SMTP_PASSWORD=***
SMTP_FROM_NAME=OGM Gönüllü Sistemi
SMTP_FROM_EMAIL=noreply@ogm.gov.tr

# ── SMS (Kurumsal SMS Sağlayıcı) ───────────────
SMS_PROVIDER=netgsm                          # netgsm | ileti_merkezi | mutlucell
SMS_API_URL=https://api.netgsm.com.tr
SMS_API_KEY=***
SMS_API_SECRET=***
SMS_SENDER_ID=OGM GONULLU
SMS_OTP_LENGTH=6
SMS_OTP_EXPIRES_IN=300                       # saniye (5 dakika)
SMS_OTP_MAX_ATTEMPTS=5
SMS_OTP_LOCKOUT_DURATION=1800                # saniye (30 dakika)
SMS_DAILY_LIMIT_PER_USER=10
SMS_RESEND_COOLDOWN=120                      # saniye (2 dakika)

# ── App URLs ────────────────────────────────────
APP_URL=https://ogm-gonullu.gov.tr
API_URL=https://api.ogm-gonullu.gov.tr

# ── Firebase (outbound internet gerektirir) ────
FIREBASE_PROJECT_ID=ogm-gonullu
FIREBASE_CREDENTIALS_PATH=/app/firebase-sa.json

# ── Nominatim (opsiyonel, on-premise container) ─
NOMINATIM_URL=http://nominatim:8080

# ── Logging ─────────────────────────────────────
LOG_LEVEL=info
LOG_DIR=/app/logs
```

### 11.6 Veritabanı Migration Stratejisi

Knex.js migration dosyaları ile yönetilir. `docker-compose up` sonrası otomatik çalışır:

```
migrations/
├── 20260316_001_create_users.js
├── 20260316_002_create_volunteer_profiles.js
├── 20260316_003_create_admin_profiles.js
├── 20260316_004_create_trainings.js
├── 20260316_005_create_volunteer_trainings.js
├── 20260316_006_create_equipment_types.js
├── 20260316_007_create_equipment_stock.js
├── 20260316_008_create_volunteer_equipment.js
├── 20260316_009_create_fires.js
├── 20260316_010_create_fire_reports.js
├── 20260316_011_create_fire_report_media.js
├── 20260316_012_create_fire_participants.js
├── 20260316_013_create_volunteer_evaluations.js
├── 20260316_014_create_sos_alerts.js
├── 20260316_015_create_notifications.js
├── 20260316_016_create_notification_recipients.js
├── 20260316_017_create_blog_posts.js
├── 20260316_018_create_user_sessions.js
├── 20260316_019_create_audit_logs.js

seeds/
├── 001_equipment_types.js
└── 002_admin_users.js
```

### 11.7 Cron Jobs

| Job | Zamanlama | Açıklama |
|-----|-----------|----------|
| SKT Kontrolü | Her gün 09:00 | Ekipman son kullanma tarihi yaklaşan kayıtları tespit eder, admin paneline uyarı oluşturur |
| Session Temizliği | Her gün 03:00 | Süresi dolmuş refresh token'ları siler |
| Konum Verisi Temizliği | Her hafta | 7 günden eski konum verilerini temizler |
| Veritabanı Yedekleme | Her gün 02:00 | `mysqldump` ile otomatik yedekleme (bkz. 11.9) |
| MinIO Yedekleme | Her gün 02:30 | `mc mirror` ile dosya yedekleme |
| Log Rotasyon | Her hafta | Eski log dosyalarını sıkıştırma ve temizleme |

### 11.8 On-Premise Sunucu Mimarisi

```
┌──────────────────────────────────────────────────────────────┐
│                    OGM Veri Merkezi                           │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              Uygulama Sunucusu (Ana)                   │  │
│  │  OS: Ubuntu 22.04 LTS / RHEL 9                        │  │
│  │  CPU: 8+ core  |  RAM: 32+ GB  |  Disk: 500 GB SSD   │  │
│  │                                                        │  │
│  │  Docker Engine + Docker Compose                        │  │
│  │  ┌─────────┬─────────┬───────┬───────┬────────────┐   │  │
│  │  │  Nginx  │ Backend │ MySQL │ Redis │   MinIO    │   │  │
│  │  │  :443   │  :3000  │ :3306 │ :6379 │ :9000/9001 │   │  │
│  │  └─────────┴─────────┴───────┴───────┴────────────┘   │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              Yedekleme Alanı                            │  │
│  │  NAS / Harici Disk / Tape                              │  │
│  │  - Günlük MySQL dump                                   │  │
│  │  - Günlük MinIO mirror                                 │  │
│  │  - 30 günlük retention                                 │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌───────────────────────┐  ┌──────────────────────────┐     │
│  │  Monitoring (Ops.)    │  │  Firewall Kuralları      │     │
│  │  Prometheus + Grafana │  │  Inbound:  443/TCP only  │     │
│  │  (Docker container)   │  │  Outbound: FCM, SMTP     │     │
│  └───────────────────────┘  └──────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
```

### 11.9 Minimum Sunucu Gereksinimleri

| Bileşen | Minimum | Önerilen |
|---------|---------|----------|
| **CPU** | 4 core | 8+ core |
| **RAM** | 16 GB | 32 GB |
| **Disk** | 200 GB SSD | 500 GB SSD + NAS yedekleme |
| **OS** | Ubuntu 22.04 LTS veya RHEL 9 | Ubuntu 22.04 LTS |
| **Docker** | Docker Engine 24.x + Compose V2 | En güncel stable |
| **Ağ** | Statik IP, HTTPS sertifikası | Kurumsal SSL sertifikası |

### 11.10 Yedekleme & Felaket Kurtarma

**Günlük Otomatik Yedekleme (scripts/backup.sh):**

```bash
#!/bin/bash
# MySQL yedekleme
docker exec ogm-mysql mysqldump -u root -p${DB_ROOT_PASSWORD} \
  --single-transaction --routines --triggers ogm_gonullu \
  | gzip > /backups/mysql/ogm_gonullu_$(date +%Y%m%d_%H%M).sql.gz

# MinIO yedekleme
docker exec ogm-minio mc mirror /data /backups/minio/

# 30 günden eski yedekleri temizle
find /backups -type f -mtime +30 -delete

echo "[$(date)] Backup completed" >> /var/log/ogm-backup.log
```

**Geri Yükleme (scripts/restore.sh):**

```bash
#!/bin/bash
# En son yedeği geri yükle
LATEST=$(ls -t /backups/mysql/*.sql.gz | head -1)
gunzip -c $LATEST | docker exec -i ogm-mysql mysql -u root -p${DB_ROOT_PASSWORD} ogm_gonullu
```

### 11.11 SSL Sertifika Yönetimi

| Senaryo | Yöntem |
|---------|--------|
| **Kurumsal Sertifika** | OGM'nin mevcut CA'sından alınan sertifika Nginx'e mount edilir |
| **Self-Signed (Test)** | `openssl` ile üretilir, yalnızca staging ortamında kullanılır |
| **Let's Encrypt** | Sunucu internete açıksa, `certbot` ile otomatik yenileme (opsiyonel) |

### 11.12 Firewall & Ağ Gereksinimleri

| Yön | Port | Hedef | Açıklama |
|-----|------|-------|----------|
| **Inbound** | 443/TCP | Tüm client'lar | HTTPS (API + Admin Panel) |
| **Inbound** | 80/TCP | Tüm client'lar | HTTP → HTTPS redirect |
| **Outbound** | 443/TCP | `fcm.googleapis.com` | Firebase push notification |
| **Outbound** | 443/TCP | `oauth2.googleapis.com` | Firebase auth |
| **Outbound** | 587/TCP | `mail.ogm.gov.tr` | Kurumsal SMTP (e-posta gönderimi) |
| **Outbound** | 443/TCP | `api.netgsm.com.tr` (veya SMS sağlayıcı) | SMS OTP gönderimi |
| **Internal** | 3000, 3306, 6379, 9000, 9001 | Sadece Docker network | Container'lar arası iletişim |

### 11.13 İlk Kurulum Adımları

```bash
# 1. Sunucuya Docker Engine kur
curl -fsSL https://get.docker.com | sh

# 2. Proje dosyalarını sunucuya kopyala
scp -r ./ogm-gonullu root@sunucu:/opt/ogm-gonullu

# 3. Ortam değişkenlerini ayarla
cd /opt/ogm-gonullu
cp .env.example .env
nano .env    # Gerçek değerleri gir

# 4. SSL sertifikalarını kopyala
cp server.crt server.key docker/nginx/ssl/

# 5. Firebase service account dosyasını kopyala
cp firebase-sa.json ./

# 6. Tüm servisleri başlat
docker compose up -d

# 7. Migration'ları çalıştır
docker compose exec backend npx knex migrate:latest
docker compose exec backend npx knex seed:run

# 8. MinIO bucket oluştur
docker compose exec minio mc alias set local http://localhost:9000 $MINIO_ACCESS_KEY $MINIO_SECRET_KEY
docker compose exec minio mc mb local/ogm-gonullu-storage

# 9. Sağlık kontrolü
curl -k https://localhost/v1/health

# 10. Yedekleme cron'unu ekle
echo "0 2 * * * /opt/ogm-gonullu/scripts/backup.sh" | crontab -
```

---

## Ek: Endpoint Özet Tablosu

| # | Method | Endpoint | Auth | Rol |
|---|--------|----------|------|-----|
| 1 | POST | `/auth/register` | - | - |
| 2 | POST | `/auth/login` | - | - |
| 3 | POST | `/auth/forgot-password` | - | - |
| 4 | POST | `/auth/reset-password` | - | - |
| 5 | POST | `/auth/verify-email` | - | - |
| 6 | POST | `/auth/phone/send-otp` | Yes | All |
| 7 | POST | `/auth/phone/verify-otp` | Yes | All |
| 8 | POST | `/auth/resend-verification` | Yes | All |
| 9 | POST | `/auth/change-password` | Yes | All |
| 10 | POST | `/auth/refresh` | - | - |
| 11 | POST | `/auth/logout` | Yes | All |
| 12 | POST | `/volunteers/profile` | Yes | volunteer |
| 13 | GET | `/volunteers/profile` | Yes | volunteer |
| 14 | PUT | `/volunteers/profile` | Yes | volunteer |
| 15 | PUT | `/volunteers/profile/location` | Yes | volunteer |
| 16 | GET | `/volunteers/trainings` | Yes | volunteer |
| 17 | GET | `/volunteers/equipment` | Yes | volunteer |
| 18 | GET | `/trainings` | Yes | All |
| 19 | GET | `/trainings/:id` | Yes | All |
| 20 | POST | `/trainings/:id/enroll` | Yes | volunteer |
| 21 | DELETE | `/trainings/:id/enroll` | Yes | volunteer |
| 22 | POST | `/fires/report` | Yes | volunteer |
| 23 | POST | `/fires/:fireId/respond` | Yes | volunteer |
| 24 | POST | `/sos` | Yes | volunteer |
| 25 | GET | `/notifications` | Yes | volunteer |
| 26 | PATCH | `/notifications/:id/read` | Yes | volunteer |
| 27 | POST | `/notifications/read-all` | Yes | volunteer |
| 28 | GET | `/blog/posts` | Yes | All |
| 29 | GET | `/blog/posts/:slug` | Yes | All |
| 30 | GET | `/admin/volunteers` | Yes | admin, ogm_officer |
| 31 | GET | `/admin/volunteers/:id` | Yes | admin, ogm_officer |
| 32 | PATCH | `/admin/volunteers/:id/status` | Yes | admin, ogm_officer |
| 33 | POST | `/admin/volunteers/:id/evaluate` | Yes | admin, ogm_officer |
| 34 | POST | `/admin/volunteers/:id/equipment` | Yes | admin, ogm_officer |
| 35 | GET | `/admin/volunteers/:id/equipment` | Yes | admin, ogm_officer |
| 36 | POST | `/admin/trainings` | Yes | admin, ogm_officer |
| 37 | PUT | `/admin/trainings/:id` | Yes | admin, ogm_officer |
| 38 | PATCH | `/admin/trainings/:id/volunteers/:volunteerId/status` | Yes | admin, ogm_officer |
| 39 | GET | `/admin/equipment/types` | Yes | admin, ogm_officer |
| 40 | POST | `/admin/equipment/types` | Yes | admin |
| 41 | GET | `/admin/equipment/stock` | Yes | admin, ogm_officer |
| 42 | PUT | `/admin/equipment/stock/:id` | Yes | admin, ogm_officer |
| 43 | PATCH | `/admin/equipment/assignments/:id` | Yes | admin, ogm_officer |
| 44 | GET | `/admin/equipment/expiring` | Yes | admin, ogm_officer |
| 45 | POST | `/admin/fires` | Yes | admin |
| 46 | GET | `/admin/fires` | Yes | admin, ogm_officer |
| 47 | GET | `/admin/fires/:id` | Yes | admin, ogm_officer |
| 48 | PUT | `/admin/fires/:id` | Yes | admin |
| 49 | POST | `/admin/fires/:id/call-volunteers` | Yes | admin |
| 50 | GET | `/admin/fires/:id/volunteers` | Yes | admin, ogm_officer |
| 51 | GET | `/admin/fires/reports` | Yes | admin, ogm_officer |
| 52 | PATCH | `/admin/fires/reports/:id` | Yes | admin |
| 53 | GET | `/admin/sos` | Yes | admin, ogm_officer |
| 54 | PATCH | `/admin/sos/:id` | Yes | admin, ogm_officer |
| 55 | POST | `/admin/notifications` | Yes | admin |
| 56 | GET | `/admin/notifications` | Yes | admin |
| 57 | POST | `/admin/blog/posts` | Yes | admin |
| 58 | PUT | `/admin/blog/posts/:id` | Yes | admin |
| 59 | DELETE | `/admin/blog/posts/:id` | Yes | admin |
| 60 | GET | `/admin/dashboard/summary` | Yes | admin, ogm_officer |
| 61 | GET | `/admin/dashboard/active-fires` | Yes | admin, ogm_officer |
| 62 | GET | `/admin/dashboard/volunteers-map` | Yes | admin |
| 63 | POST | `/admin/users` | Yes | admin (superadmin) |
| 64 | GET | `/admin/users` | Yes | admin (superadmin) |
| 65 | PUT | `/admin/users/:id` | Yes | admin (superadmin) |
