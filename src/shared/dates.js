'use strict';

/** Date|string → 'YYYY-MM-DD' (tarih-only alanlar için, kontrat 0.3). */
function toDateOnly(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/** Date|string → ISO 8601 (tarih+saat alanlar için). */
function toIso(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

module.exports = { toDateOnly, toIso };
