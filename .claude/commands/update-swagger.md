---
description: Swagger / OpenAPI dokümantasyonunu yeni endpoint değişikliklerine göre günceller ve docs/openapi.json'a yazar.
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# /update-swagger — Swagger güncelle

Bu komut, son geliştirme adımında yapılmış endpoint değişikliklerini analiz eder, eksik OpenAPI JSDoc bloklarını yeni endpoint'lere ekler, mevcut blokları güncel tutar ve `docs/openapi.json`'u yeniden üretir.

Argümanlar (opsiyonel): `$ARGUMENTS`
- Argüman yoksa: son `git diff HEAD~1` veya çalışma dizinindeki staged/unstaged değişiklikleri kapsar.
- Belirli bir modül adıysa (`auth`, `users`, `reports` vb.): yalnızca o modülü inceler.
- `--full`: tüm `src/modules/**/*.routes.js` dosyalarını yeniden gözden geçirir.

## Yapılacak işlemler (sırayla)

1. **Değişikliği belirle**
   - `git status --porcelain` ve `git diff --name-only` ile değişen dosyaları bul.
   - Filter: `src/modules/**/*.{routes,controller}.js` ile `src/modules/**/*.docs.js`.
   - Eğer git geçmişi yoksa, `find src/modules -mmin -120 -name "*.routes.js"` (son 2 saat) fallback'i kullan.

2. **Eksik JSDoc blokları tespit et**
   - Her `*.routes.js` için `router.<method>(...)` çağrılarını listele.
   - Her route için yukarıda `@openapi` etiketli JSDoc bloğunun var olup olmadığını kontrol et.
   - Eksik olan veya path/method'u yanlış olan blokları işaretle.

3. **JSDoc blokları yaz / güncelle**
   - Eksik bloklar için boilerplate üret:
     - `tags`: modül adından türet (`users` → `Users`, `auth/phone` → `Auth - Phone`).
     - `summary`: handler adından, controller dosyasındaki yorumdan veya yakın method adından çıkar.
     - `requestBody` ve `responses`: validator dosyasındaki Joi şemasından türet.
     - `security`: route `requireAuth` middleware kullanıyorsa `bearerAuth`, `requireAuthOrRegistration` ise her ikisi.
   - Mevcut bloklar için path veya method değişmişse güncelle.
   - Hiçbir endpoint'i kaldırma — sadece ekle/güncelle.
   - **Asla** validator (`Joi`) dosyalarını aktif olarak değiştirme; sadece şemayı OKU ve OpenAPI'ye çevir.

4. **Component/şema bütünlüğünü koru**
   - Yeni schema'lar gerekiyorsa `src/config/swagger.js` içindeki `components.schemas` bloğuna ekle.
   - Mevcut schema'ları silme. İhtiyaç yoksa yeni schema ekleme — `$ref` kullan.
   - Tag'ler için: `src/config/swagger.js` `tags[]` listesine yeni tag ekle (yalnızca eksikse).

5. **Spec'i export et**
   - `npm run swagger:export` çalıştır.
   - `docs/openapi.json` güncellenecek; çıktı içinde `paths: N, operations: M` raporu görünmeli.
   - Hata olursa swagger.js veya route JSDoc'larını düzelt, tekrar dene (max 2 deneme).

6. **Özet rapor**
   - Hangi route dosyaları güncellendi
   - Kaç yeni endpoint dökümante edildi
   - `docs/openapi.json`'da net `paths` ve `operations` sayısı
   - Eğer git repo ise `git diff --stat docs/ src/` sonucunu göster

## Kritik kurallar

- **Validation kurallarını uydurma**: Joi şemasında olmayan bir kuralı OpenAPI'ye eklemeyin.
- **Veri tipi uyumluluğu**: Frontend `src/features/onboarding/schemas.ts` ile birebir uyumlu kalsın (TC kimlik 11 hane, telefon E.164, kanGrubu enum'u vb.).
- **Türkçe summary**: Tüm `summary` ve `description` Türkçe olmalı, kod örnekleri İngilizce kalabilir.
- **Hassas alan asla örnekte gösterilme**: gerçek TC, telefon, mail örnekleri yerine `10000000146`, `+905321234567`, `kullanici@example.com` gibi hayali ama formatlı değerler kullan.
- Önce `git status` + ilgili dosyaları oku, sonra düzenleme yap. Asla körlüğüne yaz.

## Örnek kullanım

```
/update-swagger              # son değişiklikleri analiz et + güncelle
/update-swagger users        # sadece users modülü
/update-swagger --full       # tüm modülleri yeniden gözden geçir
```
