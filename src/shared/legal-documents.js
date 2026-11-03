'use strict';

// Yayımlanan yasal metinler (GET /legal/:document) ve onay kaydında beklenen sürüm.
const DOCUMENTS = {
  kvkk: {
    version: 'v1.0',
    updatedAt: '2026-04-27',
    title: 'KVKK Aydınlatma Metni',
    body:
      'Kişisel verileriniz, T.C. Orman Genel Müdürlüğü tarafından 6698 sayılı KVKK kapsamında ' +
      'orman gönüllüsü kayıt ve yönetim süreçleri için işlenmektedir. Saklama süresi: aktif ' +
      'kullanım süresince + 9 yıl (Sağlık Bakanlığı raporu yasası gereği). Verilerinizin tümünü ' +
      'GET /v1/users/me/data-export ile indirebilir, DELETE /v1/users/me ile silebilirsiniz.',
  },
  'aydinlatma-metni': {
    version: 'v1.0',
    updatedAt: '2026-04-27',
    title: 'Aydınlatma Metni',
    body:
      'Bu metin, 6698 sayılı KVKK Madde 10 kapsamında tarafınıza sunulan aydınlatma metnidir. ' +
      'Toplanan veriler: TC Kimlik, Ad, Soyad, Doğum Tarihi, Telefon, E-posta, Adres, Kan Grubu, ' +
      'Sağlık Raporu, Sabıka Kaydı. Hukuki sebepler: kanuni yükümlülük + açık rıza.',
  },
  'acik-riza': {
    version: 'v1.0',
    updatedAt: '2026-04-27',
    title: 'Açık Rıza Metni',
    body:
      'Yukarıda belirtilen kişisel verilerimin (özel nitelikli sağlık raporu ve sabıka kaydı dahil) ' +
      'OGM tarafından gönüllü yönetimi süreçleri için işlenmesine açık rıza gösteriyorum.',
  },
};

// Onay kaydı (consents.document) belge adlarını alt çizgiyle tutar; yayın anahtarları tirelidir.
const CONSENT_DOCUMENT_KEYS = {
  kvkk: 'kvkk',
  aydinlatma: 'aydinlatma-metni',
  acik_riza: 'acik-riza',
};

/** Onay verilen belgenin yayımlanan sürümü; bilinmeyen belge için null. */
function publishedVersion(consentDocument) {
  const key = CONSENT_DOCUMENT_KEYS[consentDocument];
  return key ? DOCUMENTS[key].version : null;
}

module.exports = { DOCUMENTS, CONSENT_DOCUMENT_KEYS, publishedVersion };
