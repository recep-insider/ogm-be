'use strict';

/**
 * TC Kimlik No doğrulaması — MİA checksum algoritması.
 *
 * Kurallar:
 *   - 11 hane, sadece rakam.
 *   - İlk hane != 0.
 *   - 10. hane = ((1+3+5+7+9. hanelerin toplamı * 7) - (2+4+6+8. hanelerin toplamı)) mod 10
 *   - 11. hane = (ilk 10 hanenin toplamı) mod 10
 */
function validateTcKimlik(value) {
  if (typeof value !== 'string') return false;
  if (!/^\d{11}$/.test(value)) return false;
  if (value[0] === '0') return false;

  const d = value.split('').map((c) => Number(c));
  const oddSum = d[0] + d[2] + d[4] + d[6] + d[8];
  const evenSum = d[1] + d[3] + d[5] + d[7];

  const tenth = ((oddSum * 7) - evenSum) % 10;
  const tenthNorm = ((tenth % 10) + 10) % 10;
  if (tenthNorm !== d[9]) return false;

  const eleventh = (d.slice(0, 10).reduce((a, b) => a + b, 0)) % 10;
  return eleventh === d[10];
}

module.exports = { validateTcKimlik };
