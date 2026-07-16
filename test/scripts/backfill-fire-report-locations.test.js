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
});
