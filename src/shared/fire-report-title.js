'use strict';

// backend-gereksinimleri.md §5 / prd.md §7 — İhbar başlığı ADRESTEN değil posta kodu +
// il/ilçeden türer ve açık adresi göstermez: `[Posta Kodu] İl, İlçe`.
// Aynı posta kodundan AYNI GÜN birden fazla ihbar gelirse ilki sırasız kalır,
// sonrakiler havuzdaki sırasına göre `001`, `002`... eki alır.
// Sıra kararlı olmak zorundadır (oluşturulma zamanı) — aksi halde numaralar kayar.

/** 'YYYY-MM-DD' — aynı gün karşılaştırması için (UTC, kayıtlar UTC saklanıyor). */
function dayKey(createdAt) {
  return new Date(createdAt).toISOString().slice(0, 10);
}

/**
 * Tek bir ihbarın başlığı.
 * @param {{postal_code?:string|null, il?:string|null, ilce?:string|null, location_name?:string|null}} row
 * @param {number} [ordinal] Aynı posta kodu + gün içindeki sırası (0 → eksiz)
 */
function ihbarBasligi(row, ordinal = 0) {
  const yer = [row.il, row.ilce].filter(Boolean).join(', ');
  // Posta kodu veya il/ilçe çözülemediyse başlık uydurulmaz; eldeki konum adına düşülür.
  if (!row.postal_code && !yer) return row.location_name || 'Bilinmeyen Konum';
  const base = row.postal_code ? `[${row.postal_code}] ${yer}`.trim() : yer;
  return ordinal > 0 ? `${base} ${String(ordinal).padStart(3, '0')}` : base;
}

/**
 * Bir kayıt kümesine başlıkları atar. Numaralandırma kümenin TAMAMI üzerinden
 * yapılmalıdır; sayfalanmış bir dilim tek başına doğru sırayı veremez.
 * @param {Array<object>} rows created_at ASC sıralı olmalı
 * @returns {Map<string, string>} id → başlık
 */
function ihbarBasliklari(rows) {
  const counters = new Map();
  const titles = new Map();
  const ordered = [...rows].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  for (const row of ordered) {
    if (!row.postal_code) {
      titles.set(row.id, ihbarBasligi(row));
      continue;
    }
    const key = `${row.postal_code}|${dayKey(row.created_at)}`;
    const seen = counters.get(key) || 0;
    titles.set(row.id, ihbarBasligi(row, seen));
    counters.set(key, seen + 1);
  }
  return titles;
}

module.exports = { ihbarBasligi, ihbarBasliklari, dayKey };
