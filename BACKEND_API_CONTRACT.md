# Backend API Contract — OGM Gönüllü Mobile App

> **Üretim tarihi:** 2026-05-20
> **Frontend repo commit:** `3ff0489`
> **Stack:** React Native 0.84 + TypeScript strict + Axios + React Query + React Hook Form / Zod
> **Toplam endpoint:** 32 (ana liste) — Ek B'de 2 ek dev-only / TBD endpoint

Bu doküman, frontend kodundan **birebir** çıkarılmış endpoint kontratıdır. Her endpoint için:
- Frontend kullanım yeri (`file:line`)
- Auth gereksinimi
- Request / response JSON örnekleri (TypeScript tiplerinden türetilmiş)
- Error durumları
- Mock kaynağı (`src/services/api/mocks.ts`)
- TypeScript tip referansı (`src/services/api/types.ts`)

Frontend tüm endpoint'leri tek bir `axios` instance üzerinden tüketir (`src/services/api/client.ts:29`). Endpoint path'leri **frontend kodundaki halleriyle birebir korunmalıdır** — iyileştirme önerileri Ek B'de.

---

## 0. Genel Konvansiyonlar

### 0.1 Base URL
- Placeholder: `{{API_BASE_URL}}`
- Frontend default (dev tunnel): `https://range-attitudes-suddenly-glucose.trycloudflare.com/v1` (`src/config/env.ts:14`)
- Production'da `react-native-config` üzerinden env'den okunacak (FRONTEND_CHANGES.md madde 5).

### 0.2 Authentication
- **Bearer JWT** — `Authorization: Bearer <accessToken>` header, axios interceptor tarafından otomatik eklenir (`src/services/api/client.ts:37-65`).
- **3 token tipi:**
  1. **Access token** — kısa ömürlü (~15 dk), AsyncStorage'da (`ogm.auth.access`). Standart isteklerde kullanılır.
  2. **Refresh token** — uzun ömürlü, Keychain'de (`ogm.gonullu.refresh`). 401 alındığında `POST /auth/refresh` ile yeni access token alınır (`src/services/api/client.ts:69-89`).
  3. **Registration token** — geçici, AsyncStorage'da (`ogm.auth.registration`). Yeni kullanıcı OTP'yi doğruladıktan sonra (`isExisting: false`) verilir, onboarding tamamlanana kadar yalnızca `/onboarding/complete` çağrısında kullanılır.
- **Public endpoint'ler** (auth header eklenmez): tüm `/auth/*` route'ları (`src/services/api/endpoints/auth.ts:21`).

### 0.3 Date Format
- **ISO 8601** her yerde.
  - Tarih-only fieldlar (e.g. `dogumTarihi`, `startDate`): `YYYY-MM-DD`
  - Tarih+saat fieldlar (e.g. `submittedAt`, `publishedAt`, `startedAt`): `YYYY-MM-DDTHH:mm:ssZ`
- Frontend `tr-TR` locale'ine göre render eder; backend ham ISO döner.

### 0.4 Error Envelope (Standart)
Tüm 4xx/5xx response'ları aşağıdaki şema ile dönecek:

```json
{
  "error": {
    "code": "invalid_credentials",
    "message": "Geçersiz doğrulama kodu. Lütfen tekrar deneyin.",
    "details": { "field": "code" }
  }
}
```

- `code`: programatik tanımlayıcı (snake_case, ASCII). Frontend `code` üzerinden switch yapacak (örn. `validation_error`, `not_found`).
- `message`: Türkçe, user-facing. Frontend toast/alert'lerde olduğu gibi gösterir (`getApiErrorMessage` — `src/services/api/client.ts:136-150`).
- `details` (opsiyonel): validation hata listesi, ek metadata.

### 0.5 Pagination
**Yok.** Frontend tüm list endpoint'lerini flat `T[]` olarak tüketiyor (`useBlogPosts`, `useFireMissions`, `useCompletedTrainings`, `useMyFireReports` vs.). Pagination'a geçiş ileride backend tarafından tetiklenirse `FRONTEND_CHANGES.md`'ye geçiş notu eklenir.

### 0.6 Multipart Upload Pattern
4 endpoint multipart kullanır. Standart desen:
- `Content-Type: multipart/form-data`
- JSON metadata: `data` alanı içinde string olarak
- Binary asset'ler: ayrı form field'lar (alan adları endpoint-specific)

Multipart endpoint'ler:
1. `POST /onboarding/complete` — `data` (JSON) + `saglikRaporu` (file) + `sabikaKaydi` (file)
2. `POST /users/me/avatar` — `avatar` (file)
3. `POST /missions/active/{id}/photos` — `file` (image/video)
4. `POST /fire-reports` — `data` (JSON) + `media[]` (multiple files)

### 0.7 Field Naming Dili
Tüm domain fieldları **Türkçe**: `ad`, `soyad`, `dogumTarihi`, `tcKimlik`, `eposta`, `telefon`, `adres`, `kanGrubu`, `ogrenim`, `meslek`, `meslekDiger`, `hobiler`, `acil`, `yakinlik`. Frontend bu adlandırmayı bekliyor; **değiştirilmemeli**. İngilizce mapping önerisi varsa Ek B'ye yazın.

### 0.8 Görsel Asset'leri
Tüm asset alanları (`cover`, `gallery`, `instructorAvatar`, `avatarUrl`, `BlogContentBlock.image.source`, `certificateUrl`) backend tarafından **fully-qualified HTTPS URL** olarak dönmelidir (S3/Cloudflare R2/eşdeğeri CDN). Mock'larda yerel `require()` referansları var — production'da string URL beklenir. Frontend tip narrowing'i `FRONTEND_CHANGES.md` madde 1'de.

### 0.9 Coordinates
Tüm konum fieldları:
```json
{ "lat": 36.85, "lng": 28.27 }
```
WGS84 datum. Frontend `react-native-maps` ile uyumlu.

### 0.10 Phone Format
**E.164** zorunlu (örn. `+905551234567`). Frontend `validateE164` ile pre-validate eder (`src/utils/validators/phone.ts`).

### 0.11 TC Kimlik
11 haneli, frontend `validateTcKimlik` ile çek-numarası kontrolünden geçirir (`src/utils/validators/tcKimlik.ts`). Backend tekrar doğrulamalı.

---

## 1. Authentication

7 endpoint. Tümü public (auth header'sız).

### 1.1 POST /auth/phone/send-otp
- **Kullanıldığı yer:** `src/services/api/endpoints/auth.ts:25`, `src/features/auth/context.tsx:154`
- **Auth:** Hayır
- **Request Body:**
```json
{ "phone": "+905551234567" }
```
- **Success Response (200):**
```json
{
  "sessionId": "sess_abc123",
  "expiresIn": 300,
  "cooldownSec": 60
}
```
- **Error cases:**
  - `400 invalid_phone` — E.164 değil
  - `429 rate_limited` — çok sık deneme
- **TS tipleri:** `SendOtpRequest`, `SendOtpResponse` (`src/services/api/types.ts:87-94`)
- **Mock:** `src/services/api/mocks.ts:172` (`mockApi.sendOtp`)
- **Notlar:** `cooldownSec` saniye geçmeden resendOtp çağrılmamalı.

---

### 1.2 POST /auth/phone/verify-otp
- **Kullanıldığı yer:** `src/services/api/endpoints/auth.ts:38`, `src/features/auth/context.tsx:195`
- **Auth:** Hayır
- **Request Body:**
```json
{ "sessionId": "sess_abc123", "code": "123456" }
```
- **Success Response (200) — `oneOf`:**

**Mevcut kullanıcı (`isExisting: true`):**
```json
{
  "ok": true,
  "isExisting": true,
  "accessToken": "eyJ...",
  "refreshToken": "rft_xyz",
  "expiresIn": 900,
  "user": {
    "id": "u_123",
    "tcKimlik": "12345678901",
    "ad": "Özge",
    "soyad": "Demir",
    "dogumTarihi": "1992-03-14",
    "phone": "+905551234567",
    "eposta": "ozge@example.com",
    "profileComplete": true
  }
}
```

**Yeni kullanıcı (`isExisting: false`):**
```json
{
  "ok": true,
  "isExisting": false,
  "registrationToken": "regt_xyz",
  "expiresIn": 900
}
```

- **Error cases:**
  - `400 invalid_otp` — yanlış kod
  - `410 otp_expired` — `expiresIn` aşıldı
- **TS tipleri:** `VerifyOtpRequest`, `VerifyOtpExisting`, `VerifyOtpNew` (`src/services/api/types.ts:97-115`)
- **Mock:** `src/services/api/mocks.ts:188`
- **Notlar:** Mock `MOCK_REGISTERED_PHONES` listesindeki numaralar `isExisting: true` döner; gerisi `false`.

---

### 1.3 POST /auth/phone/resend-otp
- **Kullanıldığı yer:** `src/services/api/endpoints/auth.ts:51`, `src/features/auth/context.tsx:232`
- **Auth:** Hayır
- **Request Body:**
```json
{ "sessionId": "sess_abc123" }
```
- **Success Response (200):**
```json
{ "cooldownSec": 60, "expiresIn": 300 }
```
- **Error cases:** `429 rate_limited`, `404 session_not_found`
- **TS tipleri:** `ResendOtpRequest`, `ResendOtpResponse` (`src/services/api/types.ts:118-124`)
- **Mock:** `mocks.ts:mockApi.resendOtp`

---

### 1.4 POST /auth/edevlet/initiate
- **Kullanıldığı yer:** `src/services/api/endpoints/auth.ts:64`, `src/screens/Splash/components/ActionButtons.tsx:37`
- **Auth:** Hayır
- **Request Body:**
```json
{ "callbackScheme": "ogmgonullu" }
```
`callbackScheme` opsiyonel; mobile deep-link scheme'i.
- **Success Response (200):**
```json
{
  "sessionId": "edsess_abc",
  "redirectUrl": "https://giris.turkiye.gov.tr/...?session=edsess_abc",
  "expiresIn": 600
}
```
- **Error cases:** `503 edevlet_unavailable`
- **TS tipleri:** `EdevletInitiateRequest`, `EdevletInitiateResponse` (`types.ts:127-134`)
- **Mock:** `mocks.ts:mockApi.edevletInitiate`
- **Notlar:** Frontend `redirectUrl`'i `react-native-webview` içinde açacak, callback'i deep link ile yakalayacak (FRONTEND_CHANGES.md madde 4). Şu an DEV'de mock GET endpoint (Ek B.2) kullanılıyor.

---

### 1.5 POST /auth/edevlet/callback
- **Kullanıldığı yer:** `src/services/api/endpoints/auth.ts:82`, `src/screens/Splash/components/ActionButtons.tsx:40`
- **Auth:** Hayır
- **Request Body:**
```json
{ "sessionId": "edsess_abc", "code": "ed_oauth_code", "state": "csrf_token" }
```
- **Success Response (200):**
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "rft_xyz",
  "expiresIn": 900,
  "isExisting": true,
  "user": {
    "id": "u_456",
    "tcKimlik": "12345678901",
    "ad": "Mert",
    "soyad": "Yılmaz",
    "dogumTarihi": "1990-07-22",
    "phone": null,
    "eposta": null,
    "profileComplete": false
  }
}
```
- **Notlar:**
  - **Yeni kullanıcı için `refreshToken: null`** dönmelidir. Onboarding tamamlanmadan kalıcı session açılmamalı; frontend `accessToken`'i registration-equivalent gibi kullanır.
  - **Mevcut kullanıcı için `refreshToken` string** dönmelidir.
- **Error cases:** `400 invalid_oauth_code`, `410 session_expired`
- **TS tipleri:** `EdevletCallbackRequest`, `EdevletCallbackResponse` (`types.ts:135-146`)
- **Mock:** `mocks.ts:mockApi.edevletCallback`

---

### 1.6 POST /auth/refresh
- **Kullanıldığı yer:** `src/services/api/endpoints/auth.ts:121`; **otomatik** olarak `client.ts:75` (401 interceptor)
- **Auth:** Hayır (refresh token body'de)
- **Request Body:**
```json
{ "refreshToken": "rft_xyz" }
```
- **Success Response (200):**
```json
{ "accessToken": "eyJ...", "refreshToken": "rft_new", "expiresIn": 900 }
```
- **Error cases:** `401 invalid_refresh_token` (frontend logout flow tetiklenir, `client.ts:86`)
- **TS tipleri:** `RefreshRequest`, `AuthTokenPair` (`types.ts:35-39, 149-151`)
- **Mock:** `mocks.ts:mockApi.refresh`
- **Notlar:** Sliding refresh — backend her refresh'te yeni refresh token üretip dönmeli (frontend overwrite ediyor — `client.ts:82`).

---

### 1.7 POST /auth/logout
- **Kullanıldığı yer:** `src/services/api/endpoints/auth.ts:134`, `src/features/auth/context.tsx:274`
- **Auth:** Hayır (refresh token body'de revoke için)
- **Request Body:**
```json
{ "refreshToken": "rft_xyz" }
```
- **Success Response (200):** Body yok (frontend `void` bekliyor).
- **Error cases:** Sessiz tolere edilir (frontend logout flow her durumda devam eder).
- **TS tipi:** `LogoutRequest` (`types.ts:152-154`)
- **Mock:** `mocks.ts:mockApi.logout`

---

## 2. Onboarding

1 endpoint. Multipart.

### 2.1 POST /onboarding/complete
- **Kullanıldığı yer:** `src/services/api/endpoints/onboarding.ts:56`
  - Telefon flow: `src/screens/Onboarding/BelgeYukleme/index.tsx:141`
  - e-Devlet flow: `src/screens/Onboarding/Edevlet/EdBelge/index.tsx:91`
- **Auth:**
  - Telefon flow: **registration token** (`useRegistrationToken: true`)
  - e-Devlet flow: **access token** (yeni kullanıcı için `accessToken`-only session)
- **Content-Type:** `multipart/form-data`
- **Form Fields:**
  - `data` (text, JSON encoded): `OnboardingData`
  - `saglikRaporu` (file): image (jpeg/png/heic/heif/webp) veya `application/pdf`, max 10MB
  - `sabikaKaydi` (file): aynı kısıtlar

**`data` JSON şeması:**
```json
{
  "kimlik": {
    "tcKimlik": "12345678901",
    "ad": "Özge",
    "soyad": "Demir",
    "dogumTarihi": "1992-03-14"
  },
  "iletisim": {
    "eposta": "ozge@example.com",
    "adres": "Atatürk Cad. No:1 Daire 5, Kadıköy / İstanbul",
    "telefon": "+905551234567"
  },
  "kisisel": {
    "kanGrubu": "0+",
    "ogrenim": "Lisans",
    "meslek": "Mühendis",
    "meslekDiger": null,
    "hobiler": ["Doğa yürüyüşü", "Fotoğrafçılık"]
  },
  "acil": {
    "ad": "Ali",
    "soyad": "Demir",
    "telefon": "+905551110000",
    "yakinlik": "Eş"
  }
}
```

- **`iletisim.telefon`** opsiyonel: Telefon-OTP flow'unda zaten frontend phone'u tutuyor; e-Devlet flow'unda kullanıcı bu adımda telefon giriyor.
- **`kisisel.meslekDiger`**: `meslek === "Diğer"` ise zorunlu, aksi takdirde `null`.

- **Success Response (200):**
```json
{
  "applicationId": "app_xyz123",
  "status": "pending",
  "submittedAt": "2026-05-20T14:32:00Z",
  "user": {
    "id": "u_789",
    "tcKimlik": "12345678901",
    "ad": "Özge",
    "soyad": "Demir",
    "dogumTarihi": "1992-03-14",
    "phone": "+905551234567",
    "eposta": "ozge@example.com",
    "profileComplete": true
  },
  "tokens": {
    "accessToken": "eyJ...",
    "refreshToken": "rft_new",
    "expiresIn": 900
  }
}
```

- **`tokens` alanı:**
  - Telefon flow için **zorunlu** — registration token burada kalıcı access/refresh çiftine dönüşür.
  - e-Devlet flow için `null` olabilir (kullanıcı zaten authenticated).

- **Error cases:**
  - `400 validation_error` (details: alan bazlı hata listesi)
  - `409 already_applied` — bu kullanıcı zaten başvuru yapmış
  - `413 file_too_large`
  - `415 unsupported_media_type`
- **TS tipleri:** `OnboardingData`, `OnboardingCompleteResponse`, `CompleteOnboardingArgs` (`types.ts:157-189`, `onboarding.ts:15-19`)
- **Validation kuralları (frontend `src/features/onboarding/schemas.ts`):**
  - `tcKimlik`: 11 hane + çek algoritması
  - `dogumTarihi`: geçmişte + 18+ yaş
  - `eposta`: RFC 5322
  - `adres`: min 10 karakter
  - `hobiler`: min 1 item
  - `acil.telefon`: E.164
  - `saglikRaporu` / `sabikaKaydi`: `image/*` veya `application/pdf`, max 10MB
- **Mock:** `mocks.ts:mockApi.onboardingComplete`

---

## 3. Users

1 endpoint.

### 3.1 GET /users/me
- **Kullanıldığı yer:** `src/services/api/endpoints/users.ts:9`
  - Session restore: `src/features/auth/context.tsx:127`
  - Profil hub: `src/screens/Profil/hooks/useProfile.ts:28`
- **Auth:** Evet (access token)
- **Request:** —
- **Success Response (200):**
```json
{
  "id": "u_123",
  "tcKimlik": "12345678901",
  "ad": "Özge",
  "soyad": "Demir",
  "dogumTarihi": "1992-03-14",
  "phone": "+905551234567",
  "eposta": "ozge@example.com",
  "profileComplete": true,
  "adres": "Atatürk Cad. No:1, Kadıköy / İstanbul",
  "kanGrubu": "0+",
  "ogrenim": "Lisans",
  "meslek": "Mühendis",
  "meslekDiger": null,
  "hobiler": ["Doğa yürüyüşü", "Fotoğrafçılık"],
  "acil": {
    "ad": "Ali",
    "soyad": "Demir",
    "telefon": "+905551110000",
    "yakinlik": "Eş"
  },
  "applicationStatus": "approved",
  "volunteerLevel": {
    "level": 2,
    "name": "Aktif Gönüllü",
    "progressPercent": 64,
    "trainingsRemaining": 3
  },
  "avatarUrl": "https://cdn.example.com/avatars/u_123.jpg",
  "hasProtectiveEquipment": true
}
```
- **Error cases:** `401 unauthorized` (interceptor refresh dener)
- **TS tipi:** `UserProfile` (`types.ts:66-84`)
- **Mock:** `mocks.ts:mockApi.me`
- **Notlar:**
  - `hasProtectiveEquipment` aktif görev "Katıl" butonunu gate'liyor (`types.ts:78-82`).
  - `applicationStatus: 'requires_revision'` durumunda frontend revize bildirimi gösterir.

---

## 4. Profile

3 endpoint.

### 4.1 PATCH /users/me
- **Kullanıldığı yer:** `src/services/api/endpoints/profile.ts:21`, `src/screens/Profil/hooks/useProfile.ts:39`
- **Auth:** Evet
- **Request Body (tüm alanlar opsiyonel — partial update):**
```json
{
  "phone": "+905557654321",
  "eposta": "yeni@example.com",
  "adres": "Yeni adres, 10 karakter+",
  "kanGrubu": "A+",
  "ogrenim": "Yüksek Lisans",
  "meslek": "Diğer",
  "meslekDiger": "Mimar",
  "hobiler": ["Yüzme"],
  "avatarUrl": "https://cdn.example.com/avatars/u_123.jpg"
}
```
- **Success Response (200):** Güncel `UserProfile` (3.1 ile aynı şema).
- **Error cases:** `400 validation_error`, `409 phone_taken`, `409 email_taken`
- **TS tipi:** `UpdateProfileRequest` (`types.ts:286-296`)
- **Mock:** `mocks.ts:mockApi.updateProfile`

---

### 4.2 PUT /users/me/acil
- **Kullanıldığı yer:** `src/services/api/endpoints/profile.ts:30`, `src/screens/Profil/hooks/useProfile.ts:58`
- **Auth:** Evet
- **Request Body (tam değişim — replace):**
```json
{
  "ad": "Ali",
  "soyad": "Demir",
  "telefon": "+905551110000",
  "yakinlik": "Eş"
}
```
- **Success Response (200):** Güncel `UserProfile`
- **Error cases:** `400 validation_error`
- **TS tipi:** `AcilIletisim` (`types.ts:52-57`)
- **Mock:** `mocks.ts:mockApi.updateAcil`

---

### 4.3 POST /users/me/avatar
- **Kullanıldığı yer:** `src/services/api/endpoints/profile.ts:43`, `src/screens/Profil/hooks/useProfile.ts:86`
- **Auth:** Evet
- **Content-Type:** `multipart/form-data`
- **Form Fields:**
  - `avatar` (file): `image/jpeg` veya `image/png` (frontend default `image/jpeg`)
- **Success Response (200):** Güncel `UserProfile` (yeni `avatarUrl` ile)
- **Error cases:** `413 file_too_large`, `415 unsupported_media_type`
- **TS tipi:** `AvatarUploadAsset` (`types.ts:299-303`)
- **Mock:** `mocks.ts:mockApi.uploadAvatar`

---

## 5. Trainings (Catalog — Eğitimler Tab)

3 endpoint.

### 5.1 GET /trainings/online
- **Kullanıldığı yer:** `src/services/api/endpoints/trainings.ts:21`, `src/screens/Egitimler/hooks/useTrainings.ts:23`
- **Auth:** Evet
- **Success Response (200):**
```json
[
  {
    "id": "ot_1",
    "title": "Orman Yangınları Temel Bilgisi",
    "description": "Yangın davranışı ve müdahale...",
    "durationMin": 45,
    "iconTone": "primary",
    "status": "in_progress",
    "progressPercent": 65
  },
  {
    "id": "ot_2",
    "title": "İlkyardım",
    "description": "...",
    "durationMin": 120,
    "iconTone": "tertiary",
    "status": "not_started",
    "progressPercent": 0
  }
]
```
- **TS tipleri:** `OnlineTraining`, `OnlineTrainingStatus`, `OnlineTrainingTone` (`types.ts:193-204`)
- **Mock:** `mocks.ts:562-581` (`MOCK_ONLINE_TRAININGS`)
- **Notlar:** Kullanıcı bazlı progress; backend per-user filter yapmalı.

---

### 5.2 GET /trainings/saha
- **Kullanıldığı yer:** `src/services/api/endpoints/trainings.ts:30`, `src/screens/Egitimler/hooks/useTrainings.ts:37`
- **Auth:** Evet
- **Success Response (200):**
```json
[
  {
    "id": "st_1",
    "title": "Yangın Söndürme Saha Eğitimi",
    "location": "Muğla / Marmaris Eğitim Kampı",
    "startDate": "2026-09-18",
    "startTime": "09:00",
    "endTime": "17:00",
    "instructorName": "Ahmet Yıldız",
    "instructorAvatar": "https://cdn.example.com/instructors/ahmet.jpg",
    "cover": "https://cdn.example.com/saha/yangin.jpg",
    "availableSeats": 12,
    "seatStatus": "available",
    "applied": false
  }
]
```
- **TS tipleri:** `SahaTraining`, `SahaSeatStatus` (`types.ts:206-231`)
- **Mock:** `mocks.ts:593-650` (`MOCK_SAHA_TRAININGS`)
- **Notlar:**
  - `instructorAvatar` / `cover`: **URL string** (mock'ta `require()`'lu asset — bkz. Bölüm 0.8).
  - `seatStatus: 'last_seats'` → frontend kırmızı rozet gösterir.
  - `applied: true` → kullanıcının önceden başvurduğu kayıt.

---

### 5.3 POST /trainings/{id}/applications
- **Kullanıldığı yer:** `src/services/api/endpoints/trainings.ts:39`, `src/screens/Egitimler/hooks/useTrainings.ts:54`
- **Auth:** Evet
- **URL param:** `{id}` — `SahaTraining.id`
- **Request Body:** Yok (boş POST)
- **Success Response (200):**
```json
{ "applicationId": "app_t_1", "status": "pending" }
```
- **Error cases:** `409 already_applied`, `410 training_full`, `410 training_closed`
- **TS tipi:** `TrainingApplyResponse` (`types.ts:233-236`)
- **Mock:** `mocks.ts:mockApi.applyTraining`

---

## 6. Completed Trainings (Aldığım Eğitimler)

2 endpoint.

### 6.1 GET /users/me/trainings
- **Kullanıldığı yer:** `src/services/api/endpoints/completedTrainings.ts:17`, `src/screens/Profil/hooks/useCompletedTrainings.ts:16`
- **Auth:** Evet
- **Success Response (200):**
```json
[
  {
    "id": "ct_1",
    "title": "Orman Yangınları",
    "description": "Temel yangın davranışı...",
    "durationMin": 45,
    "completedAt": null,
    "instructorName": "Ahmet Yıldız",
    "progressPercent": 65,
    "status": "in_progress",
    "certificateUrl": null
  },
  {
    "id": "ct_2",
    "title": "İlkyardım",
    "description": "Saha ilkyardım...",
    "durationMin": 120,
    "completedAt": "2025-08-12",
    "instructorName": "Canan Aksoy",
    "progressPercent": 100,
    "status": "completed",
    "certificateUrl": "https://cdn.example.com/certs/ct_2.pdf"
  }
]
```
- **TS tipleri:** `CompletedTraining`, `CompletedTrainingStatus` (`types.ts:556-577`)
- **Mock:** `mocks.ts:945-980` (`MOCK_COMPLETED_TRAININGS`)
- **Notlar:**
  - `status: 'completed'` zorunlu olarak `certificateUrl: string` döner.
  - `completedAt: null` olabilir (legacy kayıtlar için).

---

### 6.2 GET /users/me/trainings/{id}/certificate
- **Kullanıldığı yer:** `src/services/api/endpoints/completedTrainings.ts:31`, `src/screens/Profil/hooks/useCompletedTrainings.ts:27`
- **Auth:** Evet
- **URL param:** `{id}` — `CompletedTraining.id`
- **Success Response (200):**
```json
{ "url": "https://cdn.example.com/certs/ct_2.pdf?sig=..." }
```
- **Error cases:** `404 certificate_not_issued` (henüz tamamlanmamış / cert oluşturulmamış)
- **TS tipi:** `CertificateDownloadResponse` (`types.ts:579-582`)
- **Mock:** `mocks.ts:mockApi.getCertificateUrl`
- **Notlar:** Frontend `url`'i native Share sheet'e iletir; signed URL idealdir (kısa TTL).

---

## 7. Active Missions (Anasayfa Lifecycle)

5 endpoint (4 confirmed + 1 proposed scan endpoint — Ek B'de tartışma).

### 7.1 GET /missions/active
- **Kullanıldığı yer:** `src/services/api/endpoints/missions.ts:49`, `src/screens/Home/hooks/useActiveMissions.ts:34`
- **Auth:** Evet
- **Query Params (opsiyonel):**
  - `lat: number`
  - `lng: number`
- **Success Response (200):**
```json
[
  {
    "id": "am_marmaris",
    "category": "LOJİSTİK DESTEK",
    "title": "Su ve Kumanya Dağıtımı",
    "shortLocation": "Muğla / Marmaris",
    "iconName": "water",
    "status": "active",
    "userStatus": "not_joined"
  },
  {
    "id": "am_fethiye",
    "category": "SAHA OPERASYONU",
    "title": "Yangın Söndürme",
    "shortLocation": "Muğla / Fethiye",
    "iconName": "helmet",
    "status": "active",
    "userStatus": "accepted"
  }
]
```
- **TS tipleri:** `ActiveMissionSummary`, `ActiveMissionStatus`, `MissionUserStatus`, `ActiveMissionIcon` (`types.ts:366-391`)
- **Mock:** `mocks.ts:mockApi.listActiveMissions` (line 361-372)
- **Notlar:**
  - Backend `lat`/`lng`'i ignore edebilir ve last-known location'ı kullanabilir.
  - `userStatus` per-user filter (her kullanıcı için ayrı state).
  - `status: 'staffed'` → tamamen dolmuş misyon (frontend "yeterli gönüllü" overlay gösterir).

---

### 7.2 GET /missions/active/{id}
- **Kullanıldığı yer:** `src/services/api/endpoints/missions.ts:63`, `src/screens/Home/hooks/useActiveMissions.ts:43`
- **Auth:** Evet
- **URL param:** `{id}`
- **Success Response (200):**
```json
{
  "id": "am_marmaris",
  "category": "LOJİSTİK DESTEK",
  "title": "Su ve Kumanya Dağıtımı",
  "shortLocation": "Muğla / Marmaris",
  "iconName": "water",
  "status": "active",
  "userStatus": "on_site",
  "regionLabel": "MUĞLA BÖLGE MÜDÜRLÜĞÜ",
  "fullTitle": "Marmaris Orman Yangını",
  "description": "Marmaris bölgesinde devam eden yangın müdahalesi...",
  "gallery": [
    "https://cdn.example.com/missions/am_marmaris/1.jpg",
    "https://cdn.example.com/missions/am_marmaris/2.jpg"
  ],
  "needs": ["Lojistik Destek", "Su ve Kumanya"],
  "stats": { "volunteers": 124, "hectares": 12.4 },
  "locationLabel": "Hisarönü, Marmaris",
  "startedAt": "2025-08-15T14:30:00Z",
  "coordinates": { "lat": 36.85, "lng": 28.27 },
  "coverageRadiusKm": 50,
  "operational": {
    "meetingPoint": "Marmaris Yangın Yönetim Merkezi",
    "requiredEquipment": "Kask, eldiven, yangın botu"
  },
  "announcements": [
    {
      "id": "ann_1",
      "message": "Kumanyalar 14:00'te dağıtılacak.",
      "publishedAt": "2026-05-20T11:00:00Z",
      "severity": "info"
    },
    {
      "id": "ann_2",
      "message": "Rüzgâr yön değiştirdi, doğu kanada dikkat.",
      "publishedAt": "2026-05-20T12:30:00Z",
      "severity": "alert"
    }
  ]
}
```
- **Error cases:** `404 mission_not_found`
- **TS tipi:** `ActiveMissionDetail` (`types.ts:430-450`)
- **Mock:** `mocks.ts:1250-1439` (`MOCK_ACTIVE_MISSIONS`)
- **Notlar:**
  - `announcements` yalnızca `userStatus === 'on_site'` iken frontend tarafında render edilir; backend her durumda dolu dönebilir.
  - `gallery`: URL string array (bkz. Bölüm 0.8).

---

### 7.3 POST /missions/active/{id}/join
- **Kullanıldığı yer:** `src/services/api/endpoints/missions.ts:74`, `src/screens/Home/hooks/useActiveMissions.ts:57`
- **Auth:** Evet
- **URL param:** `{id}`
- **Request Body:** Yok
- **Success Response (200):**
```json
{ "ok": true, "userStatus": "accepted" }
```
- **Error cases:**
  - `409 mission_full` — `status: 'staffed'`'a geçti
  - `409 already_joined`
  - `403 equipment_required` — kullanıcının `hasProtectiveEquipment: false` (backend authoritative kontrol)
- **TS tipi:** `MissionJoinResponse` (`types.ts:452-455`)
- **Mock:** `mocks.ts:mockApi.joinActiveMission`
- **Notlar:** Çağrıdan sonra frontend `/missions/active/{id}` ve `/missions/active`'i invalidate eder.

---

### 7.4 POST /missions/active/{id}/scan **(PROPOSED — Ek B.1)**
- **Kullanıldığı yer:** Frontend'de henüz **prod kullanımı yok**. `GorevQR` ekranı saha amirinin okutması için QR üretiyor (`userId + missionId`); şu an mock-only `simulateMissionQrScan` (`missions.ts:88`).
- **Önerilen davranış:** Saha amirinin tablet/uygulamasından gönderilen scan event'i — kullanıcının `userStatus`'ünü `accepted → on_site`'a çevirir.
- **Auth:** Saha amiri tokeniyle çağrılır (mobile app'den **değil**).
- **Request Body:**
```json
{ "userId": "u_123", "scannedAt": "2026-05-20T13:00:00Z" }
```
- **Success Response (200):**
```json
{ "ok": true, "userStatus": "on_site" }
```
- **Frontend sync:** Push notification (taskCalls topic) + React Query invalidation ile sync. Bu endpoint mobile app'ten doğrudan çağrılmaz — push tetiklenir, frontend `/missions/active/{id}` yeniden fetch eder.
- **Notlar (Ek B):** Backend QR validation şeması (HMAC? signed token?) ve admin/officer auth modeli backend kararıdır.

---

### 7.5 POST /missions/active/{id}/photos
- **Kullanıldığı yer:** `src/services/api/endpoints/missions.ts:116`, `src/screens/Home/hooks/useActiveMissions.ts:146`
- **Auth:** Evet
- **URL param:** `{id}`
- **Content-Type:** `multipart/form-data`
- **Form Fields:**
  - `file` (file): `image/jpeg` (default), `image/png`, veya `video/mp4`
- **Success Response (200):**
```json
{
  "ok": true,
  "submissionId": "sub_xyz",
  "status": "pending",
  "submittedAt": "2026-05-20T13:15:00Z"
}
```
- **Notlar:**
  - Submission `pending` olarak başlar. Admin panel `PUT /admin/missions/{id}/photos/{submissionId}` ile `approved`/`rejected`'e çeker (bkz. `missions.ts:101-110` yorum bloğu).
  - **Yalnızca `userStatus === 'on_site'`** olan kullanıcılar fotoğraf yükleyebilir (frontend gate'liyor; backend de doğrulamalı).
- **Error cases:** `403 not_on_site`, `413 file_too_large`, `415 unsupported_media_type`
- **TS tipleri:** `MissionPhotoAsset`, `MissionPhotoUploadResponse`, `MissionPhotoSubmissionStatus` (`types.ts:457-484`)
- **Mock:** `mocks.ts:mockApi.submitMissionPhoto`

---

## 8. Mission History (Görev Aldığım Yangınlar)

2 endpoint.

### 8.1 GET /users/me/missions
- **Kullanıldığı yer:** `src/services/api/endpoints/missions.ts:23`, `src/screens/Profil/hooks/useMissions.ts:17`
- **Auth:** Evet
- **Success Response (200):**
```json
[
  {
    "id": "fm_marmaris_2025",
    "title": "Marmaris Yangını",
    "location": "Muğla Orman İşletme Müdürlüğü",
    "startDate": "2025-09-18",
    "endDate": "2025-09-22",
    "status": "completed",
    "cover": "https://cdn.example.com/missions/fm_marmaris.jpg"
  }
]
```
- **TS tipi:** `FireMissionSummary`, `FireMissionStatus` (`types.ts:329-349`)
- **Mock:** `mocks.ts:866-894` (`MOCK_FIRE_MISSIONS`)

---

### 8.2 GET /users/me/missions/{id}
- **Kullanıldığı yer:** `src/services/api/endpoints/missions.ts:34`, `src/screens/Profil/hooks/useMissions.ts:24`
- **Auth:** Evet
- **URL param:** `{id}` — `FireMissionSummary.id`
- **Success Response (200):**
```json
{
  "id": "fm_marmaris_2025",
  "title": "Marmaris Yangını",
  "location": "Muğla Orman İşletme Müdürlüğü",
  "startDate": "2025-09-18",
  "endDate": "2025-09-22",
  "status": "completed",
  "cover": "https://cdn.example.com/missions/fm_marmaris.jpg",
  "subtitle": "Hisarönü Mevkii",
  "gallery": [
    "https://cdn.example.com/missions/fm_marmaris/1.jpg",
    "https://cdn.example.com/missions/fm_marmaris/2.jpg",
    "https://cdn.example.com/missions/fm_marmaris/3.jpg"
  ],
  "summary": "5 günlük müdahale sonucu kontrol altına alındı...",
  "stats": { "hectares": 12.4, "volunteers": 124 }
}
```
- **Error cases:** `404 mission_not_found`, `403 not_participated` (kullanıcı bu görevde değildi)
- **TS tipi:** `FireMissionDetail`, `FireMissionStats` (`types.ts:331-357`)
- **Mock:** `mocks.ts:896-943` (`MOCK_FIRE_MISSION_DETAILS`)

---

## 9. Fire Reports (Yangın İhbarı — Vatandaş Bildirimi)

2 endpoint.

### 9.1 POST /fire-reports
- **Kullanıldığı yer:** `src/services/api/endpoints/fireReport.ts:42`, `src/screens/Home/hooks/useFireReport.ts:36`
- **Auth:** Evet
- **Content-Type:** `multipart/form-data`
- **Form Fields:**
  - `data` (text, JSON encoded)
  - `media[]` (file, **min 1 zorunlu**): `image/jpeg`, `image/png`, veya `video/mp4`

**`data` JSON:**
```json
{
  "coordinates": { "lat": 36.85, "lng": 28.27 },
  "needs": ["lojistik", "su_kumanya"],
  "description": "Yoğun duman görüyorum, alev henüz görünmüyor."
}
```

- **Success Response (200):**
```json
{
  "ok": true,
  "report": {
    "id": "fr_xyz",
    "locationName": "Marmaris Ormanı",
    "regionLabel": "Muğla / Marmaris",
    "status": "reviewing",
    "submittedAt": "2026-05-20T13:30:00Z",
    "coordinates": { "lat": 36.85, "lng": 28.27 },
    "needs": ["lojistik", "su_kumanya"]
  }
}
```

- **Backend yan etkileri (`fireReport.ts:36-39` yorumlarından):**
  - `coordinates` → `locationName` / `regionLabel` reverse-geocode
  - Media moderasyon kuyruğuna persist
  - `reviewing` raporları Yangın Harekat Merkezi dashboard'una forward
  - `confirmed` durumuna geçen rapor yeni bir `ActiveMissionDetail` oluşturabilir

- **`status` transitions (`fireReport.ts:31-32`'deki admin endpoint):**
  - `PUT /admin/fire-reports/{id}` — body `{status: 'confirmed' | 'rejected', note?: string}`
  - Mobile app bu admin endpoint'i ÇAĞIRMAZ — yalnızca status değişimini React Query invalidation + push notification ile öğrenir.

- **Error cases:** `400 validation_error` (missing media), `413 file_too_large`, `429 rate_limited`
- **TS tipler:** `FireReportSubmitRequest`, `FireReportSubmitResponse`, `FireReportMedia`, `FireReportNeed`, `FireReportStatus` (`types.ts:508-552`)
- **Mock:** `mocks.ts:426-447`, auto-promotion delay: 15s (`MOCK_REPORT_APPROVAL_DELAY_MS`)

---

### 9.2 GET /users/me/fire-reports
- **Kullanıldığı yer:** `src/services/api/endpoints/fireReport.ts:72`, `src/screens/Home/hooks/useFireReport.ts:20`
- **Auth:** Evet
- **Success Response (200):**
```json
[
  {
    "id": "fr_xyz",
    "locationName": "Marmaris Ormanı",
    "regionLabel": "Muğla / Marmaris",
    "status": "confirmed",
    "submittedAt": "2026-05-20T13:30:00Z",
    "coordinates": { "lat": 36.85, "lng": 28.27 },
    "needs": ["lojistik", "su_kumanya"]
  }
]
```
- **TS tipi:** `FireReportSummary[]` (`types.ts:537-547`)
- **Mock:** `mocks.ts:mockApi.listMyFireReports`

---

## 10. Emergency Reports (Acil Durum)

1 endpoint.

### 10.1 POST /emergency
- **Kullanıldığı yer:** `src/services/api/endpoints/emergency.ts:33`, `src/screens/Home/hooks/useEmergencyReport.ts:22`
- **Auth:** Evet
- **Request Body:**
```json
{
  "missionId": "am_marmaris",
  "coordinates": { "lat": 36.85, "lng": 28.27 },
  "message": "Yaralı gönüllü var."
}
```
- Tüm alanlar opsiyonel — frontend hangi bağlamdan tetiklendiğine göre doldurur (`AcilDurum` ekranı görev içinden çağrıldıysa `missionId` set).
- **Success Response (200):**
```json
{
  "ok": true,
  "reportId": "er_xyz",
  "submittedAt": "2026-05-20T13:45:00Z",
  "dispatchedTo": "OGM Yangın Harekat Merkezi"
}
```
- **Backend yan etkileri (`emergency.ts:27-30`):**
  - Raporu persist et
  - Operasyon Merkezi dashboard'una push et
  - En yakın saha birimini reporter koordinatına yönlendir
- **Error cases:** `429 rate_limited`
- **TS tipler:** `EmergencyReportRequest`, `EmergencyReportResponse` (`types.ts:488-503`)
- **Mock:** `mocks.ts:mockApi.submitEmergencyReport`

---

## 11. Equipment (Zimmetli Ekipmanlar)

1 endpoint.

### 11.1 GET /users/me/equipment
- **Kullanıldığı yer:** `src/services/api/endpoints/equipment.ts:13`, `src/screens/Profil/hooks/useEquipment.ts:14`
- **Auth:** Evet
- **Success Response (200):**
```json
[
  {
    "id": "eq_1",
    "name": "Kask",
    "type": "Koruyucu Ekipman",
    "assignedAt": "2024-09-18",
    "expiresAt": "2025-09-18",
    "status": "expired",
    "iconName": "helmet"
  },
  {
    "id": "eq_2",
    "name": "Yangın Botu",
    "type": "Koruyucu Ekipman",
    "assignedAt": "2025-09-25",
    "expiresAt": "2026-09-25",
    "status": "active",
    "iconName": "tool"
  },
  {
    "id": "eq_3",
    "name": "Telsiz",
    "type": "İletişim Ekipmanı",
    "assignedAt": "2025-06-16",
    "expiresAt": null,
    "status": "active",
    "iconName": "radio"
  }
]
```
- **TS tipler:** `EquipmentItem`, `EquipmentStatus` (`types.ts:307-325`)
- **Mock:** `mocks.ts:836-864` (`MOCK_EQUIPMENT`)
- **Notlar:**
  - `expiresAt: null` → expiry-less item (frontend kısa kart variant'i gösterir).
  - `status: 'expiring_soon'` → backend threshold'a göre (örn. 30 gün) hesaplar.
  - `iconName`: frontend `@components/Icon` `IconName` union'ında olmalı (`helmet`, `tool`, `radio`, vs.) — yeni icon eklenirken frontend tipini güncellemek gerekir.

---

## 12. Notifications (Bildirim Ayarları)

2 endpoint.

### 12.1 GET /users/me/notifications
- **Kullanıldığı yer:** `src/services/api/endpoints/notifications.ts:17`, `src/screens/Profil/hooks/useNotifications.ts:20`
- **Auth:** Evet
- **Success Response (200):**
```json
{
  "taskCalls": true,
  "trainings": true,
  "announcements": false,
  "distance": { "km": 50, "min": 5, "max": 200 }
}
```
- **TS tipler:** `NotificationPreferences`, `NotificationDistance` (`types.ts:586-600`)
- **Mock:** `mocks.ts:1223-1228`
- **Notlar:**
  - `taskCalls`: yangın görevi push'ları (en kritik)
  - `trainings`: yeni eğitim duyuruları
  - `announcements`: genel OGM duyuruları
  - `distance.{min, max}`: backend tarafından dikte edilen alt/üst sınırlar (frontend slider için). `distance.km`: kullanıcının seçtiği değer.

---

### 12.2 PATCH /users/me/notifications
- **Kullanıldığı yer:** `src/services/api/endpoints/notifications.ts:28`, `src/screens/Profil/hooks/useNotifications.ts:37`
- **Auth:** Evet
- **Request Body (tüm alanlar opsiyonel):**
```json
{
  "taskCalls": false,
  "trainings": true,
  "announcements": true,
  "distanceKm": 75
}
```
- **Dikkat:** Request body'de `distanceKm: number` (flat) gönderilirken, response body'de `distance: { km, min, max }` (nested) döner. Backend bu asimetriyi koruyacak.
- **Success Response (200):** Güncel `NotificationPreferences` (12.1 ile aynı şema).
- **Error cases:** `400 validation_error` (örn. `distanceKm < min` veya `> max`)
- **TS tipi:** `UpdateNotificationPreferencesRequest` (`types.ts:602-607`)
- **Mock:** `mocks.ts:mockApi.updateNotificationPreferences`

---

## 13. Blog

2 endpoint.

### 13.1 GET /blog/posts
- **Kullanıldığı yer:** `src/services/api/endpoints/blog.ts:16`, `src/screens/Blog/hooks/useBlog.ts:14`
- **Auth:** Evet
- **Success Response (200):**
```json
[
  {
    "id": "bp_1",
    "title": "Orman Yangınlarında İlk Müdahale",
    "description": "Yangın çıktığı anda yapılması gerekenler...",
    "cover": "https://cdn.example.com/blog/yangin-mudahale.jpg",
    "publishedAt": "2026-05-12",
    "readTimeMin": 3,
    "themes": ["Yangın Haberleri", "Teknik Bilgiler"],
    "author": {
      "name": "OGM Uzman Kadrosu",
      "role": "Yangınla Mücadele Birimi",
      "avatar": "https://cdn.example.com/authors/ogm.jpg"
    },
    "content": [
      { "type": "paragraph", "text": "İlk dakikalar kritiktir..." },
      { "type": "heading", "text": "Müdahale Adımları" },
      { "type": "image", "source": "https://cdn.example.com/blog/inline-1.jpg" },
      { "type": "paragraph", "text": "..." }
    ]
  }
]
```
- **TS tipler:** `BlogPost`, `BlogContentBlock`, `BlogTheme`, `BlogAuthor` (`types.ts:240-272`)
- **Mock:** `mocks.ts:671-828` (`MOCK_BLOG_POSTS`)
- **Notlar:**
  - `themes`: max 2 item (product kuralı, `types.ts:268`).
  - `content`: discriminated union — `type` alanına göre `text` veya `source` taşır.
  - Tüm `cover`, `author.avatar`, `content[].source` URL string (bkz. Bölüm 0.8).

---

### 13.2 GET /blog/posts/{id}
- **Kullanıldığı yer:** `src/services/api/endpoints/blog.ts:25`, `src/screens/Blog/hooks/useBlog.ts:21`
- **Auth:** Evet
- **URL param:** `{id}` — `BlogPost.id`
- **Success Response (200):** Tek `BlogPost` (13.1 ile aynı şema).
- **Error cases:** `404 post_not_found`
- **TS tipi:** `BlogPost` (`types.ts:260-272`)
- **Mock:** `mocks.ts:mockApi.getBlogPost`

---

## Ek A — Paylaşılan TypeScript Tipleri

Aşağıdaki tipler `src/services/api/types.ts`'den birebir alınmıştır. Backend response/request şemaları bu tiplere uymalıdır.

### Enum'lar
```typescript
type KanGrubu = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | '0+' | '0-';

type Ogrenim =
  | 'Lise' | 'Ön Lisans' | 'Lisans'
  | 'Yüksek Lisans' | 'Doktora' | 'Diğer';

type Meslek =
  | 'Memur' | 'Öğretmen' | 'Mühendis'
  | 'Öğrenci' | 'Emekli' | 'Diğer';

type Yakinlik = 'Anne' | 'Baba' | 'Eş' | 'Kardeş' | 'Arkadaş' | 'Diğer';

type ApplicationStatus = 'pending' | 'approved' | 'rejected' | 'requires_revision';

type ActiveMissionStatus = 'active' | 'staffed';
type MissionUserStatus = 'not_joined' | 'accepted' | 'on_site';
type ActiveMissionIcon = 'water' | 'helmet' | 'tool' | 'first-aid';
type MissionAnnouncementSeverity = 'info' | 'alert';
type MissionPhotoSubmissionStatus = 'pending' | 'approved' | 'rejected';

type EquipmentStatus = 'active' | 'expiring_soon' | 'expired';

type OnlineTrainingStatus = 'not_started' | 'in_progress' | 'completed';
type OnlineTrainingTone = 'primary' | 'tertiary';
type SahaSeatStatus = 'available' | 'last_seats';

type CompletedTrainingStatus = 'completed' | 'in_progress';

type FireMissionStatus = 'active' | 'completed';
type FireReportStatus = 'reviewing' | 'confirmed' | 'rejected';
type FireReportNeed = 'lojistik' | 'su_kumanya' | 'ilk_yardim' | 'el_telsizi';
type FireReportMediaKind = 'image' | 'video';

type BlogTheme =
  | 'Arama Kurtarma' | 'Teknik Bilgiler' | 'Yangın Haberleri'
  | 'Sağlık' | 'Ağaçlandırma' | 'Eğitim' | 'Ekosistem';
```

### Core
```typescript
interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface UserPublic {
  id?: string;
  tcKimlik?: string | null;
  ad?: string | null;
  soyad?: string | null;
  dogumTarihi?: string | null;
  phone?: string | null;
  eposta?: string | null;
  profileComplete?: boolean;
}

interface AcilIletisim {
  ad: string;
  soyad: string;
  telefon: string;
  yakinlik: Yakinlik;
}

interface VolunteerLevel {
  level: number;
  name: string;
  progressPercent: number;
  trainingsRemaining: number;
}

interface UserProfile extends UserPublic {
  adres?: string | null;
  kanGrubu?: KanGrubu;
  ogrenim?: Ogrenim;
  meslek?: Meslek;
  meslekDiger?: string | null;
  hobiler?: string[];
  acil?: AcilIletisim;
  applicationStatus?: ApplicationStatus;
  volunteerLevel?: VolunteerLevel;
  avatarUrl?: string | null;
  hasProtectiveEquipment?: boolean;
}

interface MissionCoordinates {
  lat: number;
  lng: number;
}

interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}
```

### Mission tipleri
```typescript
interface ActiveMissionSummary {
  id: string;
  category: string;
  title: string;
  shortLocation: string;
  iconName: ActiveMissionIcon;
  status: ActiveMissionStatus;
  userStatus: MissionUserStatus;
}

interface MissionStats { volunteers: number; hectares: number; }

interface MissionOperationalInfo {
  meetingPoint: string;
  requiredEquipment: string;
}

interface MissionAnnouncement {
  id: string;
  message: string;
  publishedAt: string;
  severity: MissionAnnouncementSeverity;
}

interface ActiveMissionDetail extends ActiveMissionSummary {
  regionLabel: string;
  fullTitle: string;
  description: string;
  gallery: string[];  // URL[]
  needs: string[];
  stats: MissionStats;
  locationLabel: string;
  startedAt: string;
  coordinates: MissionCoordinates;
  coverageRadiusKm: number;
  operational: MissionOperationalInfo;
  announcements: MissionAnnouncement[];
}

interface FireMissionSummary {
  id: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string;
  status: FireMissionStatus;
  cover?: string | null;  // URL
}

interface FireMissionDetail extends FireMissionSummary {
  subtitle?: string | null;
  gallery: string[];  // URL[]
  summary: string;
  stats: { hectares: number; volunteers: number; };
}
```

### Training tipleri
```typescript
interface OnlineTraining {
  id: string;
  title: string;
  description: string;
  durationMin: number;
  iconTone: OnlineTrainingTone;
  status: OnlineTrainingStatus;
  progressPercent: number;
}

interface SahaTraining {
  id: string;
  title: string;
  location: string;
  startDate: string;    // YYYY-MM-DD
  startTime: string;    // HH:mm
  endTime: string;      // HH:mm
  instructorName: string;
  instructorAvatar?: string | null;  // URL
  cover?: string | null;             // URL
  availableSeats: number;
  seatStatus: SahaSeatStatus;
  applied: boolean;
}

interface CompletedTraining {
  id: string;
  title: string;
  description: string;
  durationMin: number;
  completedAt: string | null;  // YYYY-MM-DD
  instructorName?: string | null;
  progressPercent: number;
  status: CompletedTrainingStatus;
  certificateUrl: string | null;
}
```

### Equipment, Blog, Notifications, FireReport
```typescript
interface EquipmentItem {
  id: string;
  name: string;
  type: string;
  assignedAt: string;
  expiresAt: string | null;
  status: EquipmentStatus;
  iconName?: string;
}

type BlogContentBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'image'; source: string };  // URL

interface BlogAuthor {
  name: string;
  role: string;
  avatar?: string | null;  // URL
}

interface BlogPost {
  id: string;
  title: string;
  description: string;
  cover?: string | null;
  publishedAt: string;
  readTimeMin: number;
  themes: BlogTheme[];  // max 2
  author: BlogAuthor;
  content: BlogContentBlock[];
}

interface NotificationDistance { km: number; min: number; max: number; }
interface NotificationPreferences {
  taskCalls: boolean;
  trainings: boolean;
  announcements: boolean;
  distance: NotificationDistance;
}

interface FireReportMedia {
  uri: string;
  kind: FireReportMediaKind;
  fileName?: string | null;
  type?: string | null;
}

interface FireReportSummary {
  id: string;
  locationName: string;
  regionLabel: string;
  status: FireReportStatus;
  submittedAt: string;
  coordinates: MissionCoordinates;
  needs: FireReportNeed[];
}
```

---

## Ek B — Backend Karar Bekleyen Konular

### B.1 Mission QR Scan Endpoint **(zorunlu — yeni endpoint)**
- **İhtiyaç:** `src/screens/Home/...GorevQR` ekranı saha amirine `{userId, missionId}` QR kodu gösteriyor (`react-native-qrcode-svg`). Saha amirinin tarama event'i kullanıcının `userStatus`'ünü `accepted → on_site`'a çevirmeli.
- **Önerilen path (Bölüm 7.4):** `POST /missions/active/{id}/scan`
- **Backend karar verilmesi gerekenler:**
  1. QR payload formatı: signed token mı (HMAC), düz JSON mı, yoksa rastgele ID + lookup mı?
  2. Saha amirinin auth modeli — ayrı role (`officer`) mı, ayrı app/dashboard'dan mı çağrılacak?
  3. Mobile app'e bu transition'ı bildirim: push notification (taskCalls topic) + frontend refetch ile.
- **Şu anki frontend stub:** `missions.ts:88` (`devSimulateQrScan`) — mock-only, prod'a çıkmaz.

### B.2 `GET /auth/edevlet/mock` **(DEV-only — production'da kaldırılacak)**
- **Path:** `GET /auth/edevlet/mock?sessionId=<id>&state=<state>` → `{ code, state? }`
- **Amaç:** e-Devlet portalında onay simülasyonu — frontend `redirectUrl`'i açmadan callback `code`'unu üretebiliyor.
- **Karar:** Production'da bu endpoint olmamalı. `react-native-webview` + deep link callback flow'una geçildiğinde tamamen kaldırılır (FRONTEND_CHANGES.md madde 4).

### B.3 e-Devlet Production OAuth Callback Şeması
- Backend `redirectUrl`'in döndüğü external portal entegrasyonu (`giris.turkiye.gov.tr` veya benzeri) için OAuth client kayıt sürecini başlatmalı.
- Callback şeması: `ogmgonullu://auth/edevlet?code=...&state=...` deep link.
- Frontend WebView intercept'i + bu URL'i parse edip `POST /auth/edevlet/callback`'e iletecek.

### B.4 Pagination — İleride Liste Büyüyebilirse
Şu an tüm list endpoint'leri flat `T[]` döner. İleride pagination'a geçilirse:
- Standart envelope önerisi: `{ items: T[], page: number, pageSize: number, total: number }`
- Frontend tarafında `useInfiniteQuery` veya page tracking gerekir — `FRONTEND_CHANGES.md`'ye refactor notu eklenir.
- Aday endpoint'ler (büyüme potansiyeli): `/blog/posts`, `/users/me/missions`, `/users/me/fire-reports`, `/missions/active`, `/users/me/trainings`.

### B.5 Realtime Sync Stratejisi
- **Karar:** Polling/refetch + push notification (Notifee).
- **Mobile pattern:** React Query stale-time 30s + manual invalidation + push notification topic subscription. Bu battery ve network açısından mobil için doğru çözüm.
- **Push payload önerisi:**
  - **Topic: `taskCalls`** → yeni aktif görev / fire report onaylandı / saha QR tarandı
  - **Topic: `trainings`** → yeni saha eğitimi / online eğitim
  - **Topic: `announcements`** → genel duyurular
- Backend her topic için per-user opt-in'i `NotificationPreferences` üzerinden okumalı (`taskCalls`, `trainings`, `announcements` boolean'larına saygı göstermeli).

### B.6 Görsel Asset Hosting
- Tüm asset URL'leri **HTTPS** + fully-qualified olmalı (S3 / Cloudflare R2 / eşdeğer CDN).
- Signed URL'ler kabul edilebilir (özellikle private cert PDF'leri için tercih edilir — `certificateUrl`).
- Mobile app `Image` component'ı `{ uri: <URL> }` formatında tüketir.

### B.7 Endpoint Path Düzeltme Önerileri (Backend Tarafından İletilebilir)
**Frontend path'lerine dokunulmamalıdır** — ancak backend bir tutarsızlık tespit ederse buradan tartışılabilir.
- Tutarsızlık tespit edildi: `/missions/active` vs `/users/me/missions` — aktif görevler global namespace'te, geçmiş görevler kullanıcı namespace'te. Eğer tüm görevleri `/users/me/missions?status=active` altında birleştirme tercihi varsa, frontend `FRONTEND_CHANGES.md`'ye refactor yazılır.

### B.8 Mock Auth Artefacts (Preview/QA)
- `MOCK_OTP = '123456'`, `MOCK_REGISTERED_PHONES = ['+905555555555', '+905666666666']`, demo seed user'ları (Özge, Mert) — frontend `useMockBackend=true` ile QA için kullanıyor.
- Production backend'inde **seed user / OTP bypass yok** — backend yalnızca production-grade flow'u implement etsin. QA için ayrı staging env önerilir.

### B.9 Mission `userStatus` Persistence
- `userStatus` per-user × per-mission state. Backend büyük olasılıkla `mission_user_status` tablosunda tutacak (`(user_id, mission_id) → 'not_joined' | 'accepted' | 'on_site'`).
- Default `'not_joined'` döner (row yoksa).
- `'on_site'` transition'ı yalnızca scan endpoint (B.1) ile.

### B.10 Volunteer Level Hesaplaması
- `UserProfile.volunteerLevel` (`VolunteerLevel`) frontend tarafından read-only kullanılıyor.
- Backend `level`, `name`, `progressPercent`, `trainingsRemaining` alanlarını eğitim/görev kayıtlarından türetmeli. Hesaplama kuralları ürün ekibiyle netleştirilmeli.

---

## Self-Check (Doküman Hazırlık Kontrol Listesi)

- [x] 31 confirmed endpoint + 1 proposed (`POST /missions/active/{id}/scan`) = 32 endpoint, tümünde `file:line` referansı
- [x] Her endpoint için JSON request/response örneği
- [x] Tüm tipler `src/services/api/types.ts` türevi — uydurma yok
- [x] Auth gereksinimi her endpoint'te belirtildi
- [x] Multipart endpoint'lerin (4 adet) field adları yazıldı
- [x] `ImageSourcePropType` → `string` (URL) normalization tüm response örneklerinde uygulandı; FE refactor `FRONTEND_CHANGES.md`'de
- [x] Hata durumları HTTP code + `error.code` ile listelendi
- [x] Ek B'deki her açık sorunun frontend dosya/satır referansı var
