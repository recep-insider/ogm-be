'use strict';

// backend §2/§3/§13 — olay yaşam döngüsü, katılım kararı ve QR check-in kuralları.

const { parseVolunteerQr, qrPayloadFor, EVENT_STATUS, VOLUNTEER_SIGNALS } =
  jest.requireActual('../../../src/modules/missions/missions.service');

describe('QR sözleşmesi (§13)', () => {
  it('QR formatı OGM:VOL:{id}', () => {
    expect(qrPayloadFor('u1')).toBe('OGM:VOL:u1');
    expect(parseVolunteerQr('OGM:VOL:u1')).toBe('u1');
  });

  it('boşluklu içerik de çözülür, yanlış format çözülmez', () => {
    expect(parseVolunteerQr('  OGM:VOL:abc-123  ')).toBe('abc-123');
    expect(parseVolunteerQr('OGM:USER:u1')).toBeNull();
    expect(parseVolunteerQr(null)).toBeNull();
  });

  it('oturumsuz kullanıcı için QR üretilmez', () => {
    expect(qrPayloadFor(null)).toBeNull();
  });
});

describe('Olay durumu sözleşmesi (§3)', () => {
  it('beş durum vardır', () => {
    expect(EVENT_STATUS).toEqual(['cagrildi', 'yolda', 'sahada', 'tamamladi', 'katilamiyor']);
  });

  it('mobilden yalnızca yolda/katilamiyor sinyali gelebilir — sahada QR, tamamladi arşivleme ile', () => {
    expect(VOLUNTEER_SIGNALS).toEqual(['yolda', 'katilamiyor']);
    expect(VOLUNTEER_SIGNALS).not.toContain('sahada');
    expect(VOLUNTEER_SIGNALS).not.toContain('tamamladi');
  });
});
