'use strict';

// backend-gereksinimleri.md §1/§7 — hazırlık zinciri, kişi durumu ve katılım engelleri.

const {
  komisyonKarari,
  teorikTamam,
  uygulamaliTamam,
  hazirlikZinciri,
  kisiDurumu,
  mudahaleYetkisi,
  katilimEngelleri,
} = require('../../src/shared/derive');
const { KKD_ITEM_KEYS } = require('../../src/shared/kkd');

const tamKkd = () => KKD_ITEM_KEYS.map((key) => ({ item_key: key }));
const tamZincir = (overrides = {}) =>
  hazirlikZinciri({
    decision: { decision: 'approved' },
    requiredTrainingIds: ['t1'],
    completedTrainingIds: ['t1'],
    attendanceRows: [{ attendance: 'katildi', grants_competency: 1 }],
    equipmentRows: tamKkd(),
    ...overrides,
  });

describe('komisyonKarari', () => {
  it('kaydı olmayan başvuru pending — "reddedildi" değil, "henüz görüşülmedi"', () => {
    expect(komisyonKarari(null)).toBe('pending');
    expect(komisyonKarari(undefined)).toBe('pending');
  });

  it('kayıt varsa kararı döner', () => {
    expect(komisyonKarari({ decision: 'approved' })).toBe('approved');
    expect(komisyonKarari({ decision: 'rejected' })).toBe('rejected');
  });
});

describe('teorikTamam — yayında + zorunlu eğitimlerin TAMAMI', () => {
  it('zorunlu eğitimlerden biri eksikse tamam değil', () => {
    expect(teorikTamam(['t1', 't2'], ['t1'])).toBe(false);
  });

  it('hepsi tamamlandıysa tamam', () => {
    expect(teorikTamam(['t1', 't2'], ['t2', 't1', 't9'])).toBe(true);
  });

  it('zorunlu eğitim tanımlı değilse kapı yok', () => {
    expect(teorikTamam([], [])).toBe(true);
  });
});

describe('uygulamaliTamam — yalnızca yetkinlik bayraklı eğitimin yoklaması', () => {
  it('bayraksız eğitime katılmak yeterli değil (buluşma/tanıtım)', () => {
    expect(uygulamaliTamam([{ attendance: 'katildi', grants_competency: 0 }])).toBe(false);
  });

  it('bayraklı eğitime kayıtlı olmak yetmez, katılmak gerekir', () => {
    expect(uygulamaliTamam([{ attendance: 'kayitli', grants_competency: 1 }])).toBe(false);
  });

  it('bayraklı eğitimde katıldı → tamam', () => {
    expect(uygulamaliTamam([{ attendance: 'katildi', grants_competency: 1 }])).toBe(true);
  });
});

describe('hazirlikZinciri', () => {
  it('dördü birden tamamsa zincir tamam ve müdahale yetkisi verilir', () => {
    const zincir = tamZincir();
    expect(zincir.tamam).toBe(true);
    expect(zincir.eksikAdimlar).toEqual([]);
    expect(zincir.siradakiAdim).toBeNull();
    expect(mudahaleYetkisi(zincir)).toBe(true);
  });

  it('sıra atlanamaz — takılınan İLK adım siradakiAdim olur', () => {
    const zincir = tamZincir({ decision: null, completedTrainingIds: [] });
    expect(zincir.eksikAdimlar).toEqual(['komisyon', 'teorik']);
    expect(zincir.siradakiAdim).toBe('komisyon');
  });

  it('KKD ömrü dolunca zincir yeniden açılır (canlı değer)', () => {
    const rows = tamKkd();
    rows[2].expires_at = new Date(Date.now() - 86400 * 1000);
    const zincir = tamZincir({ equipmentRows: rows });
    expect(zincir.kkdDurumu).toBe('eksik');
    expect(zincir.tamam).toBe(false);
  });
});

describe('kisiDurumu', () => {
  it('zincir tamam + aktif → hazir', () => {
    expect(kisiDurumu(tamZincir(), { isActive: true })).toBe('hazir');
  });

  it('eksiği olan → basvuru', () => {
    expect(kisiDurumu(tamZincir({ decision: null }), { isActive: true })).toBe('basvuru');
  });

  it('pasif operatör kararıdır, türetimi ezer', () => {
    expect(kisiDurumu(tamZincir(), { isActive: false })).toBe('pasif');
  });
});

describe('katilimEngelleri — eksiği olan hiçbir göreve katılamaz, istisna yok', () => {
  it('eksik adımları etiketiyle döner', () => {
    const engeller = katilimEngelleri(tamZincir({ equipmentRows: [] }));
    expect(engeller).toEqual([{ key: 'kkd', label: 'KKD teslimi' }]);
  });

  it('zincir tamamsa engel yok', () => {
    expect(katilimEngelleri(tamZincir())).toEqual([]);
  });
});
