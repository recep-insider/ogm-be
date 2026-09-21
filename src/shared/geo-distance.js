'use strict';

// backend-gereksinimleri.md §4 — "Yarıçap: admin mesafe GİRMEZ. Gönüllünün kendi mesafe
// tercihi tek belirleyicidir. Acil sınıfı bu tercihi bypass eder."
// Mesafe, gönüllünün seçtiği BAZ KONUMDAN ölçülür (mobil §16: yarıçap tek başına
// hangi noktadan ölçüldüğü belirsiz bir sayıydı).

const EARTH_RADIUS_KM = 6371;

const toRad = (deg) => (deg * Math.PI) / 180;

/** İki koordinat arası büyük çember mesafesi (km). */
function distanceKm(a, b) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Gönüllünün mesafe tercihi olayı kapsıyor mu?
 *
 * Baz konum SEÇİLMEMİŞSE mesafe ölçülemez. Bu durumda çağrı GÖNDERİLİR (kapsayıcı
 * davranış): tercihini henüz girmemiş bir gönüllüyü yangından habersiz bırakmak,
 * uzaktaki birine gereksiz bildirim göndermekten daha kötü bir hata. Çağrı sonucunda
 * kaç kişinin bu durumda olduğu ayrıca raporlanır ki eksik veri görünür kalsın.
 * Olayın koordinatı yoksa da aynı kural işler.
 *
 * @param {{lat:number,lng:number}|null} base   Gönüllünün baz konumu
 * @param {number|null} radiusKm                Gönüllünün mesafe tercihi
 * @param {{lat:number,lng:number}|null} target Olayın koordinatı
 * @returns {{covered:boolean, distanceKm:number|null, measurable:boolean}}
 */
function coversTarget(base, radiusKm, target) {
  const d = distanceKm(base, target);
  if (d == null || radiusKm == null) return { covered: true, distanceKm: d, measurable: false };
  return { covered: d <= radiusKm, distanceKm: d, measurable: true };
}

module.exports = { distanceKm, coversTarget, EARTH_RADIUS_KM };
