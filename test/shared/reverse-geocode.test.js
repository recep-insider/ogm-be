'use strict';

// Yangın ihbarı locationName'i, NOMINATIM_URL tüm env dosyalarında boş olduğu
// için 'Bilinmeyen Konum' placeholder'ında kalıyordu. Değer artık env'de açıkça
// tanımlı; koordinat kişisel veri olduğundan kod tarafında varsayılan YOK —
// tanımsızken dışarıya istek gitmemeli (fail-closed).

jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../../src/config/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));

describe('reverseGeocode', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // env doğrudan mock'lanıyor: config/env dotenv ile repo .env'ini okuduğu için
  // process.env üzerinden "tanımsız" senaryosu kurulamıyor.
  // resetModules axios mock'unu da tazeliyor — modülle aynı registry'den al.
  function load(nominatimUrl = '') {
    jest.resetModules();
    jest.doMock('../../src/config/env', () => ({ geo: { nominatimUrl } }));
    return { ...require('../../src/shared/reverse-geocode'), axios: require('axios') };
  }

  it('NOMINATIM_URL tanımsızken dışarıya istek atmaz, placeholder döner', async () => {
    const { reverseGeocode, PLACEHOLDER, axios } = load('');

    const result = await reverseGeocode(41.0082, 28.9784);

    expect(axios.get).not.toHaveBeenCalled();
    expect(result).toEqual({ locationName: PLACEHOLDER, regionLabel: '41.01, 28.98' });
  });

  it('NOMINATIM_URL tanımlıysa gerçek konum adını döner', async () => {
    const { reverseGeocode, axios } = load('https://nominatim.openstreetmap.org');
    axios.get.mockResolvedValue({
      data: { name: 'Alemdar Caddesi', address: { state: 'İstanbul', county: 'Fatih' } },
    });

    const result = await reverseGeocode(41.0082, 28.9784);

    expect(axios.get).toHaveBeenCalledWith(
      'https://nominatim.openstreetmap.org/reverse',
      expect.objectContaining({ headers: { 'User-Agent': 'ogm-gonullu-api' } })
    );
    expect(result).toEqual({ locationName: 'Alemdar Caddesi', regionLabel: 'İstanbul / Fatih' });
  });

  it('name yoksa adres alanlarından mahalle/ilçe türetir', async () => {
    const { reverseGeocode, axios } = load('http://nominatim:8080');
    axios.get.mockResolvedValue({
      data: { address: { neighbourhood: 'Tepe', state: 'Muğla', county: 'Marmaris' } },
    });

    const result = await reverseGeocode(36.85, 28.27);

    expect(axios.get).toHaveBeenCalledWith('http://nominatim:8080/reverse', expect.any(Object));
    expect(result).toEqual({ locationName: 'Tepe', regionLabel: 'Muğla / Marmaris' });
  });

  // timeoutMs → axios.timeout geçişi korumasız: JSDoc'a göre 0 verilirse axios
  // "timeout yok" sayar, istek hiç sonlanmaz ve o process'in kuyruğu kalıcı
  // kilitlenir. Aşağısı pass-through'u sabitler.
  it('timeoutMs verilmezse axios.get varsayılan 8000 ms timeout ile çağrılır', async () => {
    const { reverseGeocode, axios } = load('http://nominatim:8080');
    axios.get.mockResolvedValue({ data: { name: 'X', address: {} } });

    await reverseGeocode(41.0082, 28.9784);

    expect(axios.get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeout: 8000 }));
  });

  it('timeoutMs verilirse axios.get o değerle çağrılır', async () => {
    const { reverseGeocode, axios } = load('http://nominatim:8080');
    axios.get.mockResolvedValue({ data: { name: 'X', address: {} } });

    await reverseGeocode(41.0082, 28.9784, { timeoutMs: 2500 });

    expect(axios.get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeout: 2500 }));
  });

  // MEVCUT DAVRANIŞ — istenen değil: kodda 0'a karşı guard yok, değer olduğu
  // gibi axios'a geçiyor. Guard eklenirse bu test bilerek kırılmalı.
  it('timeoutMs: 0 filtrelenmez, axios.get 0 ile çağrılır (guard yok)', async () => {
    const { reverseGeocode, axios } = load('http://nominatim:8080');
    axios.get.mockResolvedValue({ data: { name: 'X', address: {} } });

    await reverseGeocode(41.0082, 28.9784, { timeoutMs: 0 });

    expect(axios.get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeout: 0 }));
  });

  it('servis hata verirse placeholder + koordinat metnine düşer', async () => {
    const { reverseGeocode, PLACEHOLDER, axios } = load('http://nominatim:8080');
    axios.get.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await reverseGeocode(41.0082, 28.9784);

    expect(result).toEqual({ locationName: PLACEHOLDER, regionLabel: '41.01, 28.98' });
  });

  it('ardışık istekleri saniyede 1 ile sınırlar (OSM kullanım politikası)', async () => {
    const { reverseGeocode, axios } = load('http://nominatim:8080');
    axios.get.mockResolvedValue({ data: { name: 'X', address: {} } });

    const started = Date.now();
    await Promise.all([reverseGeocode(41.0, 28.9), reverseGeocode(36.8, 28.2)]);

    expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
  });
});

// Kuyruk (`queue`/`lastRequestAt`) modül seviyesinde GLOBAL: çağıran kim olursa
// olsun tüm istekler tek sıraya giriyor. Aşağısı mevcut davranışı sabitler —
// bekleme süresi kuyruk derinliğiyle DOĞRUSAL artar. Fake timer kullanılıyor ki
// gerçek 1100 ms'ler beklenmesin.
describe('reverseGeocode — kuyruk derinliği', () => {
  const MIN_INTERVAL_MS = 1100;

  function loadWithStamps(nominatimUrl = 'http://nominatim:8080') {
    jest.resetModules();
    jest.doMock('../../src/config/env', () => ({ geo: { nominatimUrl } }));
    const axios = require('axios');
    const requestedAt = [];
    axios.get.mockImplementation(async () => {
      requestedAt.push(Date.now());
      return { data: { name: 'X', address: {} } };
    });
    return { ...require('../../src/shared/reverse-geocode'), requestedAt };
  }

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('eşzamanlı çağrılarda istekleri MIN_INTERVAL_MS ile aralar', async () => {
    const { reverseGeocode, requestedAt } = loadWithStamps();

    const pending = Promise.all([
      reverseGeocode(41.0, 28.9),
      reverseGeocode(36.8, 28.2),
      reverseGeocode(39.9, 32.8),
    ]);
    await jest.advanceTimersByTimeAsync(5000);
    await pending;

    const offsets = requestedAt.map((t) => t - requestedAt[0]);
    expect(offsets).toEqual([0, MIN_INTERVAL_MS, MIN_INTERVAL_MS * 2]);
  });

  it('kuyruk global: N eşzamanlı çağrıda sonuncusu (N-1) × MIN_INTERVAL_MS bekler', async () => {
    const { reverseGeocode } = loadWithStamps();
    const startedAt = Date.now();
    const finishedAt = [];
    const track = (lat, lng) => reverseGeocode(lat, lng).then(() => finishedAt.push(Date.now() - startedAt));

    const pending = Promise.all([track(41.0, 28.9), track(36.8, 28.2), track(39.9, 32.8)]);
    await jest.advanceTimersByTimeAsync(5000);
    await pending;

    expect(finishedAt[2]).toBeGreaterThanOrEqual(MIN_INTERVAL_MS * 2);
  });

  it('hata veren istek kuyruğu kilitlemez, sıradaki çağrı ilerler', async () => {
    const { reverseGeocode, PLACEHOLDER } = loadWithStamps();
    const axios = require('axios');
    axios.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const pending = Promise.all([reverseGeocode(41.0, 28.9), reverseGeocode(36.8, 28.2)]);
    await jest.advanceTimersByTimeAsync(5000);
    const [first, second] = await pending;

    expect(first.locationName).toBe(PLACEHOLDER);
    expect(second.locationName).toBe('X');
  });

  it('NOMINATIM_URL tanımsızken kuyruğa hiç girilmez (gecikme yok)', async () => {
    const { reverseGeocode } = loadWithStamps('');
    const startedAt = Date.now();
    let finishedAt;

    const pending = Promise.all([
      reverseGeocode(41.0, 28.9),
      reverseGeocode(36.8, 28.2),
      reverseGeocode(39.9, 32.8),
    ]).then(() => {
      finishedAt = Date.now() - startedAt;
    });
    await jest.advanceTimersByTimeAsync(5000);
    await pending;

    expect(finishedAt).toBe(0);
  });
});
