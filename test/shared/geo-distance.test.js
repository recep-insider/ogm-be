'use strict';

// backend §4 — yarıçapı admin girmez; gönüllünün mesafe tercihi baz konumundan ölçülür.

const { distanceKm, coversTarget } = require('../../src/shared/geo-distance');

const ANKARA = { lat: 39.93, lng: 32.86 };
const IZMIR = { lat: 38.42, lng: 27.14 };
const POLATLI = { lat: 39.58, lng: 32.14 };

describe('distanceKm', () => {
  it('bilinen iki şehir arası mesafeyi yaklaşık doğru hesaplar', () => {
    expect(Math.round(distanceKm(ANKARA, IZMIR))).toBeGreaterThan(500);
    expect(Math.round(distanceKm(ANKARA, IZMIR))).toBeLessThan(540);
  });

  it('eksik koordinatta null döner', () => {
    expect(distanceKm(null, IZMIR)).toBeNull();
    expect(distanceKm(ANKARA, { lat: 1 })).toBeNull();
  });
});

describe('coversTarget', () => {
  it('yarıçap içindeki olay kapsanır', () => {
    expect(coversTarget(ANKARA, 100, POLATLI)).toMatchObject({ covered: true, measurable: true });
  });

  it('yarıçap dışındaki olay kapsanmaz — çağrı gönderilmez', () => {
    expect(coversTarget(ANKARA, 50, IZMIR)).toMatchObject({ covered: false, measurable: true });
  });

  it('baz konum yoksa mesafe ölçülemez ve gönüllü kapsam dışı BIRAKILMAZ', () => {
    expect(coversTarget(null, 50, IZMIR)).toMatchObject({ covered: true, measurable: false });
  });

  it('olayın koordinatı yoksa da kapsayıcı davranılır', () => {
    expect(coversTarget(ANKARA, 50, null)).toMatchObject({ covered: true, measurable: false });
  });
});
