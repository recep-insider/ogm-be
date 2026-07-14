# Admin/Officer Login — Tasarım Dokümanı

**Tarih:** 2026-07-14
**Repo:** `ogm-be` (Node/Express + Knex)
**Kapsam:** BE'de admin/officer kimlik doğrulama (login) sistemi + `ogm-gonullu-panel`'in gerçek login'e bağlanması.

---

## 1. Amaç ve bağlam

OGM panele giriş yapabilmek için BE tarafında gerçek bir login mekanizması yok. Mevcut durum kod üzerinden doğrulandı:

- **Mobil gönüllü login'i** (`ogm-gonullu-app-fe`): `/auth/phone/*`, `/auth/edevlet/*`, `/auth/refresh`, `/users/me` uçlarına **gerçek BE'ye tam bağlı** çalışıyor (`useMockBackend=false`, `https://recepbiyikli.com/v1`). **Bu tarafta eksik yok.**
- **BE admin/officer login'i:** Yok. Yetki yalnızca statik `x-api-key` ile. Access token `{ sub }` ile imzalanıyor — `role` claim'i taşımadığı için `apiKeyOrRole` içindeki token-üzerinden-rol kontrolü pratikte hiç çalışmıyor.
- **Panel login'i:** `Login.jsx` sahte — BE'ye istek atmadan `onLogin({ email })` çağırıyor. `/admin/*` çağrıları bundle'a gömülü `x-api-key` (`VITE_ADMIN_API_KEY`) ile yapılıyor; kodun kendi yorumu "prod'da kullanılamaz, bundle'a gömülüyor" diyor.

`bcrypt` ve `jsonwebtoken` bağımlılıkları zaten kurulu.

**Hedef:** Panelin gerçek kullanıcı adı/şifre ile login olabildiği, rol tabanlı JWT üreten, gönüllü akışından tamamen izole bir admin/officer kimlik doğrulama sistemi.

## 2. Kararlar (onaylandı)

| Karar | Seçim |
|-------|-------|
| Admin refresh token deposu | Ayrı `admin_refresh_tokens` tablosu (gönüllü `refresh_tokens` dokunulmaz) |
| İlk admin + yeni adminler | Seed (env'den ilk admin) + admin-only oluşturma ucu; panel self-register kapalı |
| Statik x-api-key | Fallback olarak kalır; panel Bearer'a geçer |
| Officer mobil login | Bu turda kapsam dışı (altyapı destekleyecek şekilde kurulur) |

## 3. Mimari

Gönüllü kimlik doğrulama akışından **tam izolasyon** ilkesiyle tasarlanmıştır:
- Ayrı kullanıcı deposu (`admin_users`), ayrı refresh deposu (`admin_refresh_tokens`), ayrı endpoint ağacı (`/v1/admin/auth/*`).
- Ortak yeniden kullanılan altyapı: `shared/jwt.js`, `shared/audit.js`, `config/redis.js`, mevcut `apiKeyOrRole` middleware'i.

### 3.1 Şema (migrations)

**Migration `create_admin_users`:**

| Kolon | Tip | Not |
|-------|-----|-----|
| `id` | string(36) PK | uuid |
| `eposta` | string(254) unique notNullable | login kimliği |
| `ad` | string(100) | |
| `soyad` | string(100) | |
| `password_hash` | string(255) notNullable | bcrypt, 12 round |
| `role` | string(16) notNullable | `admin` \| `officer` |
| `is_active` | boolean notNullable default true | |
| `last_login_at` | timestamp nullable | |
| `deleted_at` | timestamp nullable | soft delete |
| `created_at`/`updated_at` | timestamps | |

Index: `eposta`, `role`.

**Migration `create_admin_refresh_tokens`:** Mevcut `refresh_tokens` tablosunun deseni:

| Kolon | Tip | Not |
|-------|-----|-----|
| `id` | string(36) PK | jti |
| `admin_user_id` | string(36) FK → `admin_users.id` | |
| `token_hash` | string(64) | sha256(refreshToken) |
| `user_agent` | string nullable | |
| `ip` | string nullable | |
| `expires_at` | timestamp notNullable | |
| `revoked_at` | timestamp nullable | |
| `replaced_by` | string(36) nullable | rotation zinciri |
| `created_at`/`updated_at` | timestamps | |

### 3.2 Seed

`seeds/` altında idempotent bir seed: `ADMIN_SEED_EMAIL` + `ADMIN_SEED_PASSWORD` env'i varsa ve o e-posta yoksa bir `role=admin` kaydı oluşturur (bcrypt hash). Env yoksa no-op. Şifre asla loglanmaz.

### 3.3 Token stratejisi

- Admin access token: `signAccessToken({ sub: admin.id, role: admin.role, atyp: 'admin' })`.
  - `jwt.js` payload'ı spread ettiği için `role` ve `atyp` claim'leri otomatik taşınır — `signAccessToken` gövdesinde değişiklik gerekmez.
  - `atyp: 'admin'` claim'i gönüllü token'larından ayırt etmeyi netleştirir (gönüllü token'da yoktur).
- Admin refresh token: `signRefreshToken({ sub: admin.id, jti })` — mevcut imzalayıcı; doğrulama ayrı `admin_refresh_tokens` tablosuna karşı yapılır.
- Süreler: access `JWT_ACCESS_EXPIRES_IN` (varsayılan 15dk), refresh 7 gün + rotation + redis blacklist (`bl:admin_refresh:<jti>`).

### 3.4 Middleware

`middlewares/auth.js` içindeki `requireAdmin` / `requireOfficer` (=`apiKeyOrRole`) **değişmeden çalışır** — zaten `payload.role`'ü okuyor. Tek fark: artık gerçekten `role` taşıyan token'lar üretiliyor olacak, dolayısıyla:
- Token ile gelen admin için `req.user = { id: payload.sub, role }` ve `req.actor = { type: 'token', role }` set edilir → audit `userId` artık dolar (mevcut "x-api-key'de userId NULL" kısıtı JWT yolunda çözülür).
- x-api-key yolu fallback olarak korunur.

### 3.5 Modül: `src/modules/admin/auth/`

Mevcut `src/modules/auth/` (phone/token) desenini birebir izler: `*.routes.js`, `*.controller.js`, `*.service.js`, `*.validators.js`.

| Endpoint | Auth | Açıklama |
|----------|------|----------|
| `POST /admin/auth/login` | public | `{ eposta, sifre }` → bcrypt doğrula, rate-limit, access+refresh + admin profili döner; `last_login_at` güncelle; audit `admin.login` |
| `POST /admin/auth/refresh` | public (refresh body) | rotation: eskiyi revoke, yeni access+refresh; `admin_refresh_tokens`'a karşı doğrula |
| `POST /admin/auth/logout` | public (refresh body) | refresh revoke + blacklist; audit `admin.logout` |
| `GET /admin/auth/me` | requireAdmin/Officer | oturumdaki admin profili (`{ id, eposta, ad, soyad, role }`) |

**Mount:** `app.js` içinde `app.use('/v1/admin/auth', adminAuthRoutes)` — mevcut `/v1/admin` (global `router.use(requireAdmin)`) mount'undan **ayrı ve önce**, çünkü login/refresh public olmalı.

**Rate-limit (login):** OTP servisindeki redis deseni sadeleştirilerek — IP başına ve e-posta başına başarısız deneme sayacı; eşik aşılınca geçici kilit (ör. e-posta başına 10 başarısız/15dk → kısa lockout). Sabit değerler env ile ayarlanabilir.

### 3.6 Modül: admin hesap yönetimi `/admin/staff`

İsim çakışmasını önlemek için `/admin/staff` kullanılır (`/admin/users/:id/application` gönüllü başvurusu demektir). Yalnızca `role=admin` erişir.

| Endpoint | Açıklama |
|----------|----------|
| `POST /admin/staff` | `{ eposta, ad, soyad, sifre, role }` → yeni admin/officer oluştur (bcrypt) |
| `GET /admin/staff` | admin/officer listesi (şifre hariç) |
| `PATCH /admin/staff/:id` | `is_active` / `role` güncelle (deaktive etme dahil) |

Bu uçlar mevcut `admin.routes.js` altına eklenir (zaten `requireAdmin` global'i var) veya ayrı `staff` alt-router'ı olarak mount edilir; erişim `role=admin` ile daraltılır (officer erişemez).

## 4. Panel değişiklikleri (`ogm-gonullu-panel`)

- `Login.jsx`: gerçek `POST /admin/auth/login`; access+refresh sakla (localStorage), auth state kur, hatada kullanıcıya mesaj.
- `services/api/client.js`: `/admin/*` için `Authorization: Bearer <access>`; x-api-key yalnızca local-dev fallback. `401 → /admin/auth/refresh → isteği yeniden dene`; refresh düşerse tokenları temizle + login'e dön.
- Oturum restore (cold start): saklı refresh varsa `/admin/auth/me` ile doğrula.
- Logout: `/admin/auth/logout` çağır + local temizlik.
- `Register.jsx`: self-servis kapatılır (karar). "Hesap için yöneticinize başvurun" yönlendirmesi.
- `config/env.js`: prod'da bundle'a gömülü admin key'e bağımlılık kaldırılır.

## 5. Test stratejisi

**BE (jest + supertest):**
- `login`: doğru şifre → 200 + token çifti; yanlış şifre → 401; deaktive hesap → 403; rate-limit kilidi.
- `refresh`: rotation (eski revoke, yeni geçerli); iptal edilmiş/blacklist refresh → 401.
- `logout`: sonrasında aynı refresh reddedilir.
- `me`: geçerli admin token → profil; token yok → 401.
- Rol zorlaması: officer token'ı `role=admin`-only uca (`/admin/staff`) → 403.
- `staff` oluşturma: admin oluşturabilir; officer 403; e-posta çakışması → 409.
- Seed idempotency: iki kez çalıştır → tek kayıt.

**Panel:** login → dashboard akışı manuel + minimal; 401-refresh interceptor'ı elle doğrulama.

## 6. Güvenlik notları

- Şifre politikası: min 8 karakter (validator). bcrypt 12 round. Şifre/hash asla loglanmaz.
- Access 15dk, refresh 7g, rotation + blacklist.
- Login rate-limit + hesap kilidi brute-force'a karşı.
- ⚠️ **Bilinen risk:** `deploy.sh` içinde commit'li `ADMIN_API_KEY` / `OFFICER_API_KEY` var — bu iş vesilesiyle rotasyon önerilir (bu spec'in doğrudan parçası değil ama yüzeye çıkarılıyor).
- Generic hata mesajı: "e-posta veya şifre hatalı" (kullanıcı enumeration'ı önlemek için).

## 7. Kapsam dışı (bu tur)

- Officer'ın mobil uygulamadan şifreyle giriş yapması (altyapı destekler; UI/akış sonraki iş).
- Şifre sıfırlama / "şifremi unuttum" e-posta akışı.
- 2FA.
- x-api-key'in tamamen kaldırılması.
