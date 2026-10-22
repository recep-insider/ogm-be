'use strict';

// SOS backfill: yalnızca il'i boş ve koordinatı olan çağrılar ele alınır; --dry-run
// dışarıya (Nominatim) tek istek atmaz; çözülemeyen satır atlanır ve sonraki koşuda
// yeniden denenir (kaldığı yerden devam).

const ROWS = [
  { id: 's1', lat: '36.8529000', lng: '28.2661000' },
  { id: 's2', lat: '41.0082000', lng: '28.9784000' },
];

function loadScript({ dryRun = false, rows = ROWS, geocode, selectError } = {}) {
  jest.resetModules();

  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  const scope = [];
  const updates = [];
  const makeChain = () => {
    const calls = [];
    const chain = {
      where: jest.fn((...args) => {
        calls.push(['where', ...args]);
        return chain;
      }),
      whereNull: jest.fn((...args) => {
        calls.push(['whereNull', ...args]);
        return chain;
      }),
      whereNotNull: jest.fn((...args) => {
        calls.push(['whereNotNull', ...args]);
        return chain;
      }),
      select: jest.fn(async () => {
        scope.push(calls);
        if (selectError) throw selectError;
        return rows;
      }),
      update: jest.fn(async (values) => {
        updates.push({ calls, values });
        return 1;
      }),
    };
    return chain;
  };
  const db = Object.assign(jest.fn(() => makeChain()), {
    destroy: jest.fn(async () => resolveDone()),
  });

  const reverseGeocode = geocode || jest.fn(async () => ({ il: 'Muğla', ilce: 'Marmaris' }));

  jest.doMock('../../src/config/db', () => ({ db }));
  jest.doMock('../../src/shared/reverse-geocode', () => ({ reverseGeocode }));

  const originalArgv = process.argv;
  process.argv = ['node', 'scripts/backfill-sos-locations.js', ...(dryRun ? ['--dry-run'] : [])];
  require('../../scripts/backfill-sos-locations');
  process.argv = originalArgv;

  return { done, reverseGeocode, updates, scope, db };
}

describe('scripts/backfill-sos-locations', () => {
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

  test('yalnızca il\'i boş ve koordinatı olan satırları seçer', async () => {
    const { done, db, scope } = loadScript();

    await done;

    expect(db).toHaveBeenCalledWith('sos_reports');
    expect(scope[0]).toEqual([['whereNull', 'il'], ['whereNotNull', 'lat'], ['whereNotNull', 'lng']]);
  });

  test('--dry-run geocode isteği atmaz, yazmaz ve koordinat basmaz', async () => {
    const { done, reverseGeocode, updates } = loadScript({ dryRun: true });

    await done;

    expect(reverseGeocode).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    const printed = console.log.mock.calls.flat().join('\n');
    expect(printed).toContain('2 kayıt güncellenecek (dry-run)');
    expect(printed).not.toContain('36.85');
  });

  test('koordinatı Number olarak geocode eder, il/ilçeyi il\'i hâlâ boşsa yazar', async () => {
    const { done, reverseGeocode, updates } = loadScript();

    await done;

    expect(reverseGeocode).toHaveBeenNthCalledWith(1, 36.8529, 28.2661);
    expect(updates).toHaveLength(2);
    expect(updates[0].calls).toEqual([['where', { id: 's1' }], ['whereNull', 'il']]);
    expect(updates[0].values).toMatchObject({ il: 'Muğla', ilce: 'Marmaris' });
    expect(process.exitCode).toBeUndefined();
  });

  test('il çözülemeyen satırı atlar (sonraki koşuda yeniden denenir)', async () => {
    let call = 0;
    const geocode = jest.fn(async () => {
      call += 1;
      return call === 1 ? { il: null, ilce: null } : { il: 'İstanbul', ilce: 'Fatih' };
    });
    const { done, updates } = loadScript({ geocode });

    await done;

    expect(updates).toHaveLength(1);
    expect(updates[0].calls[0]).toEqual(['where', { id: 's2' }]);
    expect(process.exitCode).toBeUndefined();
  });

  test('hiçbir satır çözülemezse exitCode = 1 (servis erişimi şüphesi)', async () => {
    const { done } = loadScript({ geocode: jest.fn(async () => ({ il: null, ilce: null })) });

    await done;

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('NOMINATIM_URL'));
  });

  test('güncellenecek kayıt yokken temiz çıkar', async () => {
    const { done, reverseGeocode } = loadScript({ rows: [] });

    await done;

    expect(reverseGeocode).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  test('sorgu patlarsa exitCode = 1 ve bağlantı kapanır', async () => {
    const { done, db } = loadScript({ selectError: new Error('ER_BAD_FIELD_ERROR') });

    await done;

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Backfill hatası:', 'ER_BAD_FIELD_ERROR');
    expect(db.destroy).toHaveBeenCalled();
  });
});
