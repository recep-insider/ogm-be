'use strict';

const { toLocalDateOnly } = require('./dates');

// Olay numarası yılı Türkiye saatine göre alınır; oluşturma ve geriye dönük doldurma aynı kuralı kullanır.
function refYear(at) {
  return Number(toLocalDateOnly(at).slice(0, 4));
}

/** OGM-2026-000123 */
function formatRefNo(year, no) {
  return `OGM-${year}-${String(no).padStart(6, '0')}`;
}

module.exports = { refYear, formatRefNo };
