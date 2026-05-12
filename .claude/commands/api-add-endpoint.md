---
description: Mevcut bir modüle yeni bir REST endpoint ekler — controller + service + validator + route + Swagger JSDoc.
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# /api-add-endpoint — Yeni endpoint ekle

Argümanlar: `$ARGUMENTS`
Örnekler:
- `users GET /me/data-export`
- `reports POST /:id/photos`
- `trainings GET /` (yeni modül oluşturma)

## Kontrol akışı

1. **Argümanı parse et**: `<modül> <METHOD> <path>` formatında bekle.
2. **Modül var mı?** `src/modules/<modül>/` dizinini kontrol et.
   - Yoksa: `controller`, `service`, `validator`, `routes` boilerplate dosyalarını oluştur ve `src/app.js`'e mount et.
3. **Controller, service, validator** dosyalarına yeni handler'ı ekle:
   - Service: business logic placeholder (TODO yorumla).
   - Controller: `req.body / req.params / req.query` parse et, service'i çağır, response döndür.
   - Validator: Joi şeması tanımla (gerekiyorsa).
4. **Route**: `router.<method>(path, [middleware...], asyncHandler(controller.X))` ekle.
5. **Swagger JSDoc**: `@openapi` ile tag, summary, requestBody, responses, security yaz.
6. `/update-swagger` komutunu çağır (veya doğrudan `npm run swagger:export`).
7. Test ya da basit smoke check için endpoint'in 200 dönebileceğini doğrula.

## Kurallar

- Yeni dosyalar `'use strict'` ile başlasın.
- TC kimlik / E.164 telefon validasyon helper'ları için `src/shared/`'i tekrar kullan.
- Auth gereksinimini doğru middleware ile belirle: `requireAuth`, `optionalAuth`, `requireAuthOrRegistration`, ya da yok.
- Rate limit gerekiyorsa route üzerinde local `express-rate-limit` instance'ı kur.
- Multipart upload gerekiyorsa `src/middlewares/upload.js`'den faydalan ya da yeni multer config ekle.
