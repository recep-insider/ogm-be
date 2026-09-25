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

// Olaylar Türkiye'de; tarih-only alan bir anlık değerden (TIMESTAMP) türetilirken gün
// UTC'ye göre değil Türkiye saatine göre alınır — 00:00–03:00 arası başlayan yangın bir
// önceki güne kaymasın.
const LOCAL_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Istanbul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Anlık değer (Date|ISO string) → Europe/Istanbul takvim günü 'YYYY-MM-DD'. */
function toLocalDateOnly(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return toDateOnly(value);
  return LOCAL_DATE_FORMAT.format(d);
}

module.exports = { toDateOnly, toLocalDateOnly, toIso };
