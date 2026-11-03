'use strict';

// --dry-run yalnızca kapsamı listeler: koordinat kişisel veri olduğundan
// prova sırasında dışarıya (Nominatim) TEK bir geocode isteği bile gitmemeli.
// Regresyon burada sessizce koordinat sızdırır — "güvenli prova" varsayımı çöker.

const PLACEHOLDER = 'Bilinmeyen Konum';

const ROWS = [
  { id: 'r1', latitude: '36.85', longitude: '28.27', location_name: PLACEHOLDER },
  { id: 'r2', latitude: '41.0082', longitude: '28.9784', location_name: '' },
];

/**
 * Script require anında main()'i çalıştırıp finally'de db.destroy() çağırıyor;
 * export'u yok. Bu yüzden argv'yi kurup modülü izole require ediyor, bitişi
 * destroy() üzerinden bekliyoruz.
 */
function loadScript({ dryRun = false, rows = ROWS, geocode, selectError } = {}) {
  jest.resetModules();

  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  const updates = [];
  const chain = {
    where: jest.fn(() => chain),
    select: jest.fn(async () => {
      if (selectError) throw selectError;
      return rows;
    }),
    update: jest.fn(async (values) => {
      updates.push(values);
      return 1;
    }),
  };
  const db = Object.assign(jest.fn(() => chain), {
    destroy: jest.fn(async () => resolveDone()),
  });

  const reverseGeocode =
    geocode || jest.fn(async () => ({ locationName: 'Tepe', regionLabel: 'Muğla / Marmaris' }));

  jest.doMock('../../src/config/db', () => ({ db }));
  jest.doMock('../../src/shared/reverse-geocode', () => ({ reverseGeocode, PLACEHOLDER }));

  const originalArgv = process.argv;
  process.argv = ['node', 'scripts/backfill-fire-report-locations.js', ...(dryRun ? ['--dry-run'] : [])];
  // DRY_RUN modül yüklenirken okunuyor — require'dan sonra argv'yi geri alabiliriz.
  require('../../scripts/backfill-fire-report-locations');
  process.argv = originalArgv;

  return { done, reverseGeocode, updates, db };
}

describe('scripts/backfill-fire-report-locations', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  describe('--dry-run', () => {
    test('hiç geocode isteği atmaz (koordinat kişisel veri)', async () => {
      const { done, reverseGeocode } = loadScript({ dryRun: true });

      await done;

      expect(reverseGeocode).not.toHaveBeenCalled();
    });

    test('hiçbir kaydı güncellemez', async () => {
      const { done, updates } = loadScript({ dryRun: true });

      await done;

      expect(updates).toEqual([]);
    });

    test('kapsamı listeler (kayıt sayısını raporlar)', async () => {
      const { done } = loadScript({ dryRun: true });

      await done;

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('2 kayıt güncellenecek (dry-run)'));
    });

    test('kayıt yokken de istek atmaz', async () => {
      const { done, reverseGeocode } = loadScript({ dryRun: true, rows: [] });

      await done;

      expect(reverseGeocode).not.toHaveBeenCalled();
    });
  });

  describe('gerçek çalıştırma (--dry-run yok)', () => {
    test('her kayıt için bir geocode isteği atar', async () => {
      const { done, reverseGeocode } = loadScript();

      await done;

      expect(reverseGeocode).toHaveBeenCalledTimes(2);
    });

    test('koordinatları Number tipine çevirerek geçirir', async () => {
      const { done, reverseGeocode } = loadScript();

      await done;

      expect(reverseGeocode).toHaveBeenNthCalledWith(1, 36.85, 28.27);
    });

    test('çözülen konumu location_name/region_label olarak yazar', async () => {
      const { done, updates } = loadScript();

      await done;

      expect(updates[0]).toMatchObject({ location_name: 'Tepe', region_label: 'Muğla / Marmaris' });
    });

    test('geocode placeholder dönerse kaydı günceller değil, atlar', async () => {
      const geocode = jest.fn(async () => ({ locationName: PLACEHOLDER, regionLabel: '36.85, 28.27' }));
      const { done, updates } = loadScript({ geocode });

      await done;

      expect(updates).toEqual([]);
    });
  });

  // Script cron/deploy adımından çağrılıyor: sorgu patlarsa süreç sessizce
  // "başarılı" (exit 0) bitmemeli, yoksa backfill atlandığı fark edilmez.
  describe('il, ilçe ve posta kodu (BUG-100)', () => {
    const FULL = { locationName: 'Tepe', regionLabel: 'Muğla / Marmaris', postalCode: '48700', il: 'Muğla', ilce: 'Marmaris' };

    test('kapsam konum adı dolu ama il\'i boş koordinatlı satırları da içerir', async () => {
      const { done, db } = loadScript({ rows: [] });
      await done;

      const scope = db.mock.results[0].value.where.mock.calls[0][0];
      const calls = [];
      const recorder = new Proxy({}, { get: (_t, name) => (...args) => { calls.push([name, ...args.map((a) => (typeof a === 'function' ? (a(recorder), 'fn') : a))]); return recorder; } });
      scope(recorder);
      expect(calls).toEqual(expect.arrayContaining([['whereNull', 'il'], ['whereNotNull', 'latitude'], ['whereNotNull', 'longitude']]));
    });

    test('beş alanın yalnız boş olanlarını yazar; dolu konum adına dokunmaz', async () => {
      const rows = [
        { id: 'r1', latitude: '36.85', longitude: '28.27', location_name: PLACEHOLDER, postal_code: null, il: null, ilce: null },
        { id: 'r3', latitude: '36.85', longitude: '28.27', location_name: 'Eski Ad', postal_code: '48000', il: null, ilce: null },
      ];
      const { done, updates } = loadScript({ rows, geocode: jest.fn(async () => FULL) });
      await done;

      expect(updates[0]).toMatchObject({ location_name: 'Tepe', region_label: 'Muğla / Marmaris', postal_code: '48700', il: 'Muğla', ilce: 'Marmaris' });
      expect(updates[1]).toMatchObject({ il: 'Muğla', ilce: 'Marmaris' });
      expect(updates[1]).not.toHaveProperty('location_name');
      expect(updates[1]).not.toHaveProperty('postal_code');
    });
  });

  describe('hata yolu', () => {
    test('select reddedilirse process.exitCode = 1 olur', async () => {
      const { done } = loadScript({ selectError: new Error('ER_NO_SUCH_TABLE') });

      await done;

      expect(process.exitCode).toBe(1);
    });

    test('select reddedilirse hata mesajını loglar', async () => {
      const { done } = loadScript({ selectError: new Error('ER_NO_SUCH_TABLE') });

      await done;

      expect(console.error).toHaveBeenCalledWith('Backfill hatası:', 'ER_NO_SUCH_TABLE');
    });

    test('select reddedilse de db bağlantısını kapatır', async () => {
      const { done, db } = loadScript({ selectError: new Error('ER_NO_SUCH_TABLE') });

      await done;

      expect(db.destroy).toHaveBeenCalled();
    });

    test('başarılı çalıştırmada exitCode set edilmez', async () => {
      const { done } = loadScript();

      await done;

      expect(process.exitCode).toBeUndefined();
    });
  });

  // Nominatim erişilemezse her satır placeholder'a düşer: script hiçbir kaydı
  // güncellemeden exit 0 ile biterse cron/deploy adımı "temiz koşu" sanır ve
  // backfill'in hiç çalışmadığı fark edilmez.
  describe('tümü başarısız koşu', () => {
    const allFail = () =>
      jest.fn(async () => ({ locationName: PLACEHOLDER, regionLabel: '36.85, 28.27' }));

    test('hiçbir kayıt güncellenemezse process.exitCode = 1 olur', async () => {
      const { done } = loadScript({ geocode: allFail() });

      await done;

      expect(process.exitCode).toBe(1);
    });

    test('hiçbir kayıt güncellenemezse teşhis mesajını loglar', async () => {
      const { done } = loadScript({ geocode: allFail() });

      await done;

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Hiçbir kayıt güncellenemedi'));
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('NOMINATIM_URL'));
    });

    test('güncellenecek kayıt yokken exitCode set edilmez (temiz koşu)', async () => {
      const { done } = loadScript({ rows: [], geocode: allFail() });

      await done;

      expect(process.exitCode).toBeUndefined();
    });

    test('kayıtların bir kısmı güncellenirse exitCode set edilmez', async () => {
      let call = 0;
      const geocode = jest.fn(async () => {
        call += 1;
        return call === 1
          ? { locationName: PLACEHOLDER, regionLabel: '36.85, 28.27' }
          : { locationName: 'Tepe', regionLabel: 'Muğla / Marmaris' };
      });
      const { done } = loadScript({ geocode });

      await done;

      expect(process.exitCode).toBeUndefined();
    });

    test('dry-run kayıt varken exitCode set etmez (güncelleme beklenmiyor)', async () => {
      const { done } = loadScript({ dryRun: true });

      await done;

      expect(process.exitCode).toBeUndefined();
    });
  });
});
