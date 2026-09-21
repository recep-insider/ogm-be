'use strict';

// backend-gereksinimleri.md §1/§6 — KKD durumu ve ömür düşümü kuralları.

const {
  kkdOmurSonu,
  kkdDurumu,
  eksikKkdKalemleri,
  kkdBeden,
  kkdKalemDurumu,
  KKD_ITEM_KEYS,
} = require('../../src/shared/kkd');

const DAY = 86400 * 1000;
const fullSet = (overrides = {}) =>
  KKD_ITEM_KEYS.map((key) => ({ item_key: key, expires_at: null, ...overrides }));

describe('kkdOmurSonu — ömür kalem tipinden gelir, elle girilmez', () => {
  it.each([
    ['kask', 5],
    ['tulum', 3],
    ['bot', 3],
    ['eldiven', 2],
    ['maske', 2],
  ])('%s kaleminin ömrü %i yıl', (key, years) => {
    const expiry = kkdOmurSonu('2026-01-15', key);
    expect(expiry.getFullYear()).toBe(2026 + years);
    expect(expiry.toISOString().slice(5, 10)).toBe('01-15');
  });

  it('bilinmeyen kalemde null döner (sert kesim uygulanamaz)', () => {
    expect(kkdOmurSonu('2026-01-15', 'telsiz')).toBeNull();
  });
});

describe('kkdDurumu', () => {
  it('beş geçerli kalem → tam', () => {
    expect(kkdDurumu(fullSet())).toBe('tam');
  });

  it('hiç kalem yok → yok', () => {
    expect(kkdDurumu([])).toBe('yok');
  });

  it('1–4 geçerli kalem → eksik', () => {
    expect(kkdDurumu([{ item_key: 'kask' }, { item_key: 'bot' }])).toBe('eksik');
  });

  it('ömrü dolan kalem OTOMATİK düşer — ayrı işlem beklenmez', () => {
    const rows = fullSet();
    rows[0].expires_at = new Date(Date.now() - DAY);
    expect(kkdDurumu(rows)).toBe('eksik');
  });

  it('iade alınan kalem sayılmaz', () => {
    const rows = fullSet();
    rows[1].returned_at = new Date();
    expect(kkdDurumu(rows)).toBe('eksik');
  });

  it('aynı kalemin ikinci zimmeti sayımı şişirmez', () => {
    expect(kkdDurumu([{ item_key: 'kask' }, { item_key: 'kask' }])).toBe('eksik');
  });

  it('standart set dışındaki ekipman KKD sayımına girmez', () => {
    expect(kkdDurumu([...fullSet(), { item_key: 'telsiz' }])).toBe('tam');
  });
});

describe('eksikKkdKalemleri', () => {
  it('yalnızca geçerli zimmeti olmayan kalemleri listeler', () => {
    expect(eksikKkdKalemleri([{ item_key: 'kask' }, { item_key: 'maske' }])).toEqual([
      'tulum',
      'bot',
      'eldiven',
    ]);
  });
});

describe('kkdBeden — profilden türer, zimmete yazılmaz', () => {
  const user = { giysi_bedeni: 'L', ayakkabi_numarasi: 43 };

  it('tulum ve eldiven giysi bedenini okur', () => {
    expect(kkdBeden('tulum', user)).toBe('L');
    expect(kkdBeden('eldiven', user)).toBe('L');
  });

  it('bot ayakkabı numarasını okur', () => {
    expect(kkdBeden('bot', user)).toBe('43');
  });

  it('bedeni olmayan kalemde null', () => {
    expect(kkdBeden('kask', user)).toBeNull();
    expect(kkdBeden('maske', user)).toBeNull();
  });
});

describe('kkdKalemDurumu', () => {
  it('iade edilen → returned, süresi geçen → expired, eşik içi → expiring_soon', () => {
    expect(kkdKalemDurumu({ returned_at: new Date() })).toBe('returned');
    expect(kkdKalemDurumu({ expires_at: new Date(Date.now() - DAY) })).toBe('expired');
    expect(kkdKalemDurumu({ expires_at: new Date(Date.now() + 10 * DAY) })).toBe('expiring_soon');
    expect(kkdKalemDurumu({ expires_at: new Date(Date.now() + 400 * DAY) })).toBe('active');
  });
});
