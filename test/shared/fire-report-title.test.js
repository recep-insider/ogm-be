'use strict';

// backend §5 / prd §7 — İhbar başlığı `[Posta Kodu] İl, İlçe`; açık adres gösterilmez.

const { ihbarBasligi, ihbarBasliklari } = require('../../src/shared/fire-report-title');

const rec = (id, createdAt, over = {}) => ({
  id,
  postal_code: '07500',
  il: 'Antalya',
  ilce: 'Serik',
  created_at: createdAt,
  ...over,
});

describe('ihbarBasligi', () => {
  it('posta kodu + il/ilçeden türer, adres göstermez', () => {
    expect(ihbarBasligi(rec('a', '2026-09-21T08:00:00Z'))).toBe('[07500] Antalya, Serik');
  });

  it('sıra numarası üç haneli sıfır dolgulu eklenir', () => {
    expect(ihbarBasligi(rec('a', '2026-09-21T08:00:00Z'), 2)).toBe('[07500] Antalya, Serik 002');
  });

  it('posta kodu ve il/ilçe yoksa başlık uydurulmaz, konum adına düşer', () => {
    const row = { postal_code: null, il: null, ilce: null, location_name: 'Bilinmeyen Konum' };
    expect(ihbarBasligi(row)).toBe('Bilinmeyen Konum');
  });
});

describe('ihbarBasliklari — aynı posta kodu, aynı gün', () => {
  it('ilki sırasız kalır, sonrakiler 001, 002 alır', () => {
    const titles = ihbarBasliklari([
      rec('b', '2026-09-21T09:00:00Z'),
      rec('a', '2026-09-21T08:00:00Z'),
      rec('c', '2026-09-21T10:00:00Z'),
    ]);

    expect(titles.get('a')).toBe('[07500] Antalya, Serik');
    expect(titles.get('b')).toBe('[07500] Antalya, Serik 001');
    expect(titles.get('c')).toBe('[07500] Antalya, Serik 002');
  });

  it('sıra oluşturulma zamanına göredir — giriş sırası numarayı kaydırmaz', () => {
    const asc = ihbarBasliklari([rec('a', '2026-09-21T08:00:00Z'), rec('b', '2026-09-21T09:00:00Z')]);
    const desc = ihbarBasliklari([rec('b', '2026-09-21T09:00:00Z'), rec('a', '2026-09-21T08:00:00Z')]);
    expect(asc.get('a')).toBe(desc.get('a'));
    expect(asc.get('b')).toBe(desc.get('b'));
  });

  it('ertesi gün sayaç sıfırlanır', () => {
    const titles = ihbarBasliklari([
      rec('a', '2026-09-21T08:00:00Z'),
      rec('b', '2026-09-22T08:00:00Z'),
    ]);
    expect(titles.get('b')).toBe('[07500] Antalya, Serik');
  });

  it('farklı posta kodları birbirinin sayacını etkilemez', () => {
    const titles = ihbarBasliklari([
      rec('a', '2026-09-21T08:00:00Z'),
      rec('b', '2026-09-21T09:00:00Z', { postal_code: '48700', il: 'Muğla', ilce: 'Marmaris' }),
    ]);
    expect(titles.get('b')).toBe('[48700] Muğla, Marmaris');
  });
});
