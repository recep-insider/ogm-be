'use strict';

// backend §11 / prd §4 — kapsam modeli: 7 coğrafi bölge, eşleşme il alanından.

const {
  REGIONS,
  REGION_KEYS,
  DEFAULT_REGION,
  regionForCity,
  citiesOfRegion,
  applyRegionFilter,
  canonicalCity,
  cityJoiValidator,
} = require('../../src/shared/regions');

describe('bölge tanımı', () => {
  it('yedi bölge vardır ve varsayılan Akdeniz\'dir', () => {
    expect(REGION_KEYS).toHaveLength(7);
    expect(DEFAULT_REGION).toBe('akdeniz');
  });

  it('81 ilin tamamı TAM OLARAK bir bölgeye aittir', () => {
    const cities = REGIONS.flatMap((r) => r.cities);
    expect(cities).toHaveLength(81);
    expect(new Set(cities.map((c) => c.toLowerCase())).size).toBe(81);
  });
});

describe('regionForCity — eşleşme il alanından', () => {
  it.each([
    ['Antalya', 'akdeniz'],
    ['Muğla', 'ege'],
    ['İstanbul', 'marmara'],
    ['Trabzon', 'karadeniz'],
    ['Ankara', 'ic-anadolu'],
    ['Van', 'dogu-anadolu'],
    ['Şanlıurfa', 'guneydogu-anadolu'],
  ])('%s → %s', (city, region) => {
    expect(regionForCity(city)).toBe(region);
  });

  it('büyük/küçük harf ve Türkçe diakritik farkları eşleşmeyi bozmaz', () => {
    expect(regionForCity('İSTANBUL')).toBe('marmara');
    expect(regionForCity('Istanbul')).toBe('marmara');
    expect(regionForCity('  mugla ')).toBe('ege');
    expect(regionForCity('KAHRAMANMARAŞ')).toBe('akdeniz');
  });

  it('tanınmayan veya boş il null döner — kayıt gruplanamaz ama elenmez', () => {
    expect(regionForCity('Xanadu')).toBeNull();
    expect(regionForCity(null)).toBeNull();
    expect(regionForCity('')).toBeNull();
  });
});

describe('applyRegionFilter — kapsam yalnızca görünümü süzer', () => {
  const makeQuery = () => {
    const calls = [];
    const q = { whereIn: (col, vals) => { calls.push({ col, vals }); return q; }, calls };
    return q;
  };

  it('bölge verilmezse hiçbir kayıt elenmez', () => {
    const q = makeQuery();
    applyRegionFilter(q, undefined, 'fr.il');
    expect(q.calls).toHaveLength(0);
  });

  it('"all" (Tüm Bölgeler) hiçbir kayıt elemez — genel müdürlük görünümü', () => {
    const q = makeQuery();
    applyRegionFilter(q, 'all', 'fr.il');
    expect(q.calls).toHaveLength(0);
  });

  it('bölge seçiliyse o bölgenin illeriyle süzer', () => {
    const q = makeQuery();
    applyRegionFilter(q, 'ege', 'fr.il');
    expect(q.calls[0].col).toBe('fr.il');
    expect(q.calls[0].vals).toEqual(citiesOfRegion('ege'));
    expect(q.calls[0].vals).toContain('Muğla');
  });

  it('tanınmayan bölge anahtarı süzme uygulamaz (sessiz boş liste üretmez)', () => {
    const q = makeQuery();
    applyRegionFilter(q, 'atlantis', 'fr.il');
    expect(q.calls).toHaveLength(0);
  });
});

describe('canonicalCity', () => {
  it.each([
    ['istanbul', 'İstanbul'],
    ['HAKKARI', 'Hakkâri'],
    ['  kahramanmaras ', 'Kahramanmaraş'],
  ])('maps %p to %p', (input, expected) => {
    expect(canonicalCity(input)).toBe(expected);
  });

  it('returns null for an unknown or empty province', () => {
    expect(canonicalCity('Atlantis')).toBeNull();
    expect(canonicalCity('')).toBeNull();
    expect(canonicalCity(null)).toBeNull();
  });
});

describe('cityJoiValidator', () => {
  const helpers = { error: jest.fn((code) => ({ __error: code })) };

  beforeEach(() => helpers.error.mockClear());

  it('returns the canonical spelling for a known province', () => {
    expect(cityJoiValidator('mugla', helpers)).toBe('Muğla');
    expect(helpers.error).not.toHaveBeenCalled();
  });

  it('reports any.invalid for an unknown province', () => {
    expect(cityJoiValidator('Gotham', helpers)).toEqual({ __error: 'any.invalid' });
  });

  it('passes null and empty string through untouched', () => {
    expect(cityJoiValidator(null, helpers)).toBeNull();
    expect(cityJoiValidator('', helpers)).toBe('');
    expect(helpers.error).not.toHaveBeenCalled();
  });
});
