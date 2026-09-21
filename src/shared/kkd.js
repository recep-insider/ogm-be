'use strict';

// backend-gereksinimleri.md §6 + prd.md §10 — KKD (kişisel koruyucu donanım) sözleşmesi.
// Standart set beş kalemdir; ömür süresi kalem tipinden gelir, teslim tarihine eklenerek
// HESAPLANIR (elle girilmez). Beden gönüllü profilinden anlık türetilir, zimmete yazılmaz.

/** @typedef {'kask'|'tulum'|'bot'|'eldiven'|'maske'} KkdItemKey */

const KKD_ITEMS = [
  { key: 'kask', label: 'Kask', lifetimeYears: 5, sizeSource: null },
  { key: 'tulum', label: 'Tulum', lifetimeYears: 3, sizeSource: 'giysi' },
  { key: 'bot', label: 'Bot', lifetimeYears: 3, sizeSource: 'ayakkabi' },
  { key: 'eldiven', label: 'Eldiven', lifetimeYears: 2, sizeSource: 'giysi' },
  { key: 'maske', label: 'Maske', lifetimeYears: 2, sizeSource: null },
];

const KKD_ITEM_KEYS = KKD_ITEMS.map((i) => i.key);
const KKD_SET_SIZE = KKD_ITEMS.length;
const KKD_TYPE = 'Koruyucu Ekipman';

// mobil-gereksinimleri.md §12'deki AÇIK SORU: "N gün kala uyar" eşiği yönetmelikte
// tanımlı değil. Mevcut equipment servisindeki 30 günlük eşik korunur; karar
// netleştiğinde yalnızca bu sabit değişir.
const EXPIRY_WARNING_DAYS = 30;

const byKey = new Map(KKD_ITEMS.map((i) => [i.key, i]));

/** Kalem tipinin tanımı; bilinmeyen anahtarda undefined. */
function kkdItem(itemKey) {
  return byKey.get(itemKey);
}

/**
 * Ömür sonu = teslim tarihi + kalem tipinin ömrü. Bilinmeyen kalemde null
 * (ömür bilinmiyorsa sert kesim uygulanamaz, kalem süresiz sayılır).
 * @param {Date|string} assignedAt
 * @param {KkdItemKey} itemKey
 * @returns {Date|null}
 */
function kkdOmurSonu(assignedAt, itemKey) {
  const item = byKey.get(itemKey);
  if (!item || assignedAt == null) return null;
  const base = assignedAt instanceof Date ? new Date(assignedAt) : new Date(assignedAt);
  if (Number.isNaN(base.getTime())) return null;
  base.setFullYear(base.getFullYear() + item.lifetimeYears);
  return base;
}

/** Kalem şu an geçerli mi — iade edilmemiş VE ömrü dolmamış. */
function gecerliKalem(row, now = new Date()) {
  if (row.returned_at) return false;
  if (!row.expires_at) return true;
  return new Date(row.expires_at).getTime() > now.getTime();
}

/**
 * §1: geçerli kalem sayısı 5 ise `tam`, 1–4 ise `eksik`, 0 ise `yok`.
 * Aynı kalemin birden fazla geçerli zimmeti sayımı şişirmesin diye kalem tipi bazında tekilleşir.
 * @param {Array<{item_key?:string, expires_at?:any, returned_at?:any}>} rows
 * @returns {'tam'|'eksik'|'yok'}
 */
function kkdDurumu(rows, now = new Date()) {
  const valid = new Set();
  for (const row of rows || []) {
    if (!byKey.has(row.item_key)) continue;
    if (gecerliKalem(row, now)) valid.add(row.item_key);
  }
  if (valid.size >= KKD_SET_SIZE) return 'tam';
  return valid.size === 0 ? 'yok' : 'eksik';
}

/** Setten eksik olan kalem anahtarları (geçerli zimmeti olmayanlar). */
function eksikKkdKalemleri(rows, now = new Date()) {
  const valid = new Set(
    (rows || []).filter((r) => byKey.has(r.item_key) && gecerliKalem(r, now)).map((r) => r.item_key),
  );
  return KKD_ITEM_KEYS.filter((k) => !valid.has(k));
}

/** Kalem bedeni gönüllü profilinden türetilir (tulum/eldiven → giysi, bot → ayakkabı). */
function kkdBeden(itemKey, user) {
  const item = byKey.get(itemKey);
  if (!item || !item.sizeSource || !user) return null;
  if (item.sizeSource === 'giysi') return user.giysi_bedeni || null;
  return user.ayakkabi_numarasi != null ? String(user.ayakkabi_numarasi) : null;
}

/** Zimmet satırının runtime durumu (expired | expiring_soon | active). */
function kkdKalemDurumu(row, now = new Date()) {
  if (row.returned_at) return 'returned';
  if (!row.expires_at) return 'active';
  const remainingMs = new Date(row.expires_at).getTime() - now.getTime();
  if (remainingMs <= 0) return 'expired';
  if (remainingMs <= EXPIRY_WARNING_DAYS * 86400 * 1000) return 'expiring_soon';
  return 'active';
}

module.exports = {
  KKD_ITEMS,
  KKD_ITEM_KEYS,
  KKD_SET_SIZE,
  KKD_TYPE,
  EXPIRY_WARNING_DAYS,
  kkdItem,
  kkdOmurSonu,
  kkdDurumu,
  eksikKkdKalemleri,
  kkdBeden,
  kkdKalemDurumu,
  gecerliKalem,
};
