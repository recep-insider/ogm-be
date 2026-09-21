'use strict';

// backend-gereksinimleri.md §10 — SOS üç değerli sözleşmesi: iptalin sahibi gönüllüdür,
// operatör aksiyonları geçmişe düşer ve durumu AYNI çağrıda günceller, yanıt süresi türetilir.

const { responseSeconds, OPERATOR_ACTIONS } = require('../../../src/modules/sos/sos.service');

describe('responseSeconds — çağrı ile İLK operatör kaydı arası', () => {
  const createdAt = new Date('2026-09-21T10:00:00Z');

  it('mobil ve sistem satırları sayılmaz, ilk operatör kaydı esas alınır', () => {
    const history = [
      { time: new Date('2026-09-21T10:00:00Z'), by_kind: 'mobil' },
      { time: new Date('2026-09-21T10:00:30Z'), by_kind: 'sistem' },
      { time: new Date('2026-09-21T10:02:00Z'), by_kind: 'operator' },
      { time: new Date('2026-09-21T10:05:00Z'), by_kind: 'operator' },
    ];
    expect(responseSeconds(createdAt, history)).toBe(120);
  });

  it('operatör kaydı yoksa (iptal edilen çağrı) hesaplanmaz', () => {
    const history = [{ time: createdAt, by_kind: 'mobil' }];
    expect(responseSeconds(createdAt, history)).toBeNull();
  });
});

describe('OPERATOR_ACTIONS — hazır aksiyonlar merkezin kendi işlemleriyle sınırlı', () => {
  it('yalnızca üç hazır aksiyon vardır', () => {
    expect(Object.keys(OPERATOR_ACTIONS)).toEqual(['called_volunteer', 'called_112', 'responded']);
  });

  it('durumu yalnızca "müdahale edildi" değiştirir; arama adımları ayrı durum değildir', () => {
    expect(OPERATOR_ACTIONS.called_volunteer.status).toBeNull();
    expect(OPERATOR_ACTIONS.called_112.status).toBeNull();
    expect(OPERATOR_ACTIONS.responded.status).toBe('responded');
  });

  it('operatör iptal aksiyonu YOKTUR — cancelled yalnızca gönüllünün sinyalidir', () => {
    expect(Object.values(OPERATOR_ACTIONS).some((a) => a.status === 'cancelled')).toBe(false);
  });
});
