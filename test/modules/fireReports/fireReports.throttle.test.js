'use strict';

// create() geocode'u await ediyor ve shared/reverse-geocode.js'teki throttle
// process başına GLOBAL bir kuyruk — yani kuyruk derinliği doğrudan ihbar
// gönderme gecikmesine dönüşür. Yangın ihbarında kaydın kendisi hayati, konum
// adı değil: create() maxWaitMs bütçesini aşacak kuyruğa hiç girmez, placeholder
// ile kaydeder. Bu dosya o üst sınırı korur — üçüncü tarafın yavaşlığı ihbar
// gönderimini bloklayamaz.

const MIN_INTERVAL_MS = 1100;
// fireReports.service.create'in reverseGeocode'a verdiği bekleme bütçesi.
const MAX_WAIT_MS = 2000;

jest.mock('axios', () => ({ get: jest.fn() }));
const inserted = [];
jest.mock('../../../src/config/db', () => {
  const chain = {
    insert: jest.fn(async (row) => {
      inserted.push(row);
      return [1];
    }),
    where: jest.fn(() => chain),
    first: jest.fn(async () => ({
      ...inserted[inserted.length - 1],
      created_at: new Date('2026-07-07T10:00:00Z'),
    })),
  };
  const db = Object.assign(jest.fn(() => chain), { raw: jest.fn() });
  return { db };
});
jest.mock('../../../src/config/redis', () => ({
  redis: { incr: jest.fn(async () => 1), expire: jest.fn(async () => 1) },
}));
jest.mock('../../../src/config/env', () => ({
  geo: { nominatimUrl: 'http://nominatim:8080' },
  upload: { dir: '/tmp' },
  api: { baseUrl: 'https://api.test' },
}));
jest.mock('../../../src/config/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/shared/push-provider', () => ({ sendPushToUser: jest.fn() }));
jest.mock('../../../src/shared/asset-url', () => ({ assetUrl: (rel) => `https://cdn.test/${rel}` }));

const files = [{ path: '/tmp/reports/x.jpg' }];
const data = { coordinates: { lat: 36.85, lng: 28.27 }, needs: [], description: 'Duman' };

/** Fake timer altında istek/tamamlanma anlarını ölçmek için taze modül grafiği. */
function load() {
  jest.resetModules();
  const axios = require('axios');
  const requestedAt = [];
  axios.get.mockImplementation(async () => {
    requestedAt.push(Date.now());
    return { data: { name: 'Tepe', address: { state: 'Muğla', county: 'Marmaris' } } };
  });
  return { service: require('../../../src/modules/fireReports/fireReports.service'), requestedAt };
}

describe('fireReports.service.create — geocode kuyruk derinliği', () => {
  beforeEach(() => {
    inserted.length = 0;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test('sıraya giren geocode istekleri MIN_INTERVAL_MS ile aralanır (OSM politikası)', async () => {
    const { service, requestedAt } = load();

    const pending = Promise.all([
      service.create({ userId: 'u1', data, files, ip: '1.1.1.1', userAgent: 'jest' }),
      service.create({ userId: 'u2', data, files, ip: '1.1.1.2', userAgent: 'jest' }),
    ]);
    await jest.advanceTimersByTimeAsync(5000);
    await pending;

    const offsets = requestedAt.map((t) => t - requestedAt[0]);
    expect(offsets).toEqual([0, MIN_INTERVAL_MS]);
  });

  test('kuyruk maxWaitMs bütçesini aşınca ihbar beklemez, placeholder ile kaydedilir', async () => {
    const { service, requestedAt } = load();
    const startedAt = Date.now();
    const finishedAt = [];
    const track = (userId, ip) =>
      service.create({ userId, data, files, ip, userAgent: 'jest' }).then((r) => {
        finishedAt.push(Date.now() - startedAt);
        return r;
      });

    // 3. ihbar geldiğinde kuyrukta 2 istek var → 2 × 1100 ms > maxWaitMs (2000).
    const pending = Promise.all([track('u1', '1.1.1.1'), track('u2', '1.1.1.2'), track('u3', '1.1.1.3')]);
    await jest.advanceTimersByTimeAsync(5000);
    const results = await pending;

    expect(finishedAt[2]).toBeLessThan(MAX_WAIT_MS);
    expect(requestedAt).toHaveLength(2); // 3. ihbar için dışarıya istek atılmadı
    // Kuyruğu atlayan ihbar en hızlı tamamlandığı için insert sırası çağrı
    // sırasını izlemez — kaydın içeriğine bak, sırasına değil.
    const names = inserted.map((r) => r.location_name).sort();
    expect(names).toEqual(['Bilinmeyen Konum', 'Tepe', 'Tepe']);
    expect(results.every((r) => r.ok)).toBe(true); // ihbar yine de kaydedildi
  });

  test('tek ihbar kuyrukta beklemez (boş kuyrukta gecikme yok)', async () => {
    const { service } = load();
    const startedAt = Date.now();
    let finishedAt;

    const pending = service
      .create({ userId: 'u1', data, files, ip: '1.1.1.1', userAgent: 'jest' })
      .then(() => {
        finishedAt = Date.now() - startedAt;
      });
    await jest.advanceTimersByTimeAsync(5000);
    await pending;

    expect(finishedAt).toBeLessThan(MIN_INTERVAL_MS);
  });

  // Regresyon: maxWaitMs bir kuyruk-derinliği bütçesiyken kuyruğa KABUL EDİLEN
  // çağrı, önündeki isteğin timeout'unu da bekliyordu (2000 ms bütçeye karşı
  // ölçülen 6000 ms). Sınır artık gerçek bir süre sınırı.
  test('önündeki istek asılı kalsa bile kabul edilen ihbar maxWaitMs içinde döner', async () => {
    const { service } = load();
    const axios = require('axios');
    // İlk istek timeoutMs'e (3000) kadar asılı kalır.
    axios.get.mockImplementationOnce(() => new Promise(() => {}));

    const startedAt = Date.now();
    const finishedAt = [];
    const track = (userId, ip) =>
      service.create({ userId, data, files, ip, userAgent: 'jest' }).then((r) => {
        finishedAt.push(Date.now() - startedAt);
        return r;
      });

    const pending = Promise.all([track('u1', '1.1.1.1'), track('u2', '1.1.1.2')]);
    await jest.advanceTimersByTimeAsync(10000);
    const results = await pending;

    expect(Math.max(...finishedAt)).toBeLessThanOrEqual(MAX_WAIT_MS);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  test('kuyruktaki geocode hatası sonraki ihbarı düşürmez', async () => {
    const { service } = load();
    const axios = require('axios');
    axios.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const pending = Promise.all([
      service.create({ userId: 'u1', data, files, ip: '1.1.1.1', userAgent: 'jest' }),
      service.create({ userId: 'u2', data, files, ip: '1.1.1.2', userAgent: 'jest' }),
    ]);
    await jest.advanceTimersByTimeAsync(5000);
    const results = await pending;

    expect(results.every((r) => r.ok)).toBe(true);
  });
});
