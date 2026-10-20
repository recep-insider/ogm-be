'use strict';

// Saha eğitimi oluşturulurken geçmiş tarih reddedilir; "bugün" İstanbul takvim günüdür.

const mockInserts = [];
const mockUpdates = [];
const mockState = { existing: undefined };

jest.mock('../../../src/config/db', () => {
  const makeChain = () => {
    const chain = {};
    for (const method of ['where', 'select']) chain[method] = jest.fn(() => chain);
    chain.first = jest.fn(async () => mockState.existing);
    chain.update = jest.fn(async (row) => {
      mockUpdates.push(row);
      return 1;
    });
    chain.insert = jest.fn(async (row) => {
      mockInserts.push(row);
      return [1];
    });
    return chain;
  };
  const dbFn = jest.fn(() => makeChain());
  dbFn.raw = jest.fn((sql) => ({ __raw: sql }));
  return { db: dbFn };
});
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));

const { adminCreateSaha, adminUpdateSaha } = require('../../../src/modules/trainings/trainings.service');

// Joi `date().iso()` 'YYYY-MM-DD' girdisini UTC gece yarısı Date'e çevirir.
const body = (day) => ({
  title: 'Saha Eğitimi',
  location: 'Antalya Kampı',
  startDate: new Date(day),
  startTime: '09:00',
  endTime: '17:00',
  instructorName: 'Kpt. Mert Tan',
  totalSeats: 30,
});

describe('trainings.service — adminCreateSaha geçmiş tarih', () => {
  beforeEach(() => {
    mockInserts.length = 0;
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    // 2026-10-19T21:30Z = İstanbul'da 2026-10-20 00:30; UTC günü hâlâ 19'u.
    jest.setSystemTime(new Date('2026-10-19T21:30:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  test('dün (İstanbul) reddedilir ve kayıt yazılmaz', async () => {
    await expect(adminCreateSaha(body('2026-10-19'))).rejects.toMatchObject({
      status: 400,
      code: 'start_date_past',
      details: { errors: [{ field: 'startDate', message: 'Eğitim tarihi bugünden önce olamaz' }] },
    });
    expect(mockInserts).toHaveLength(0);
  });

  test('bugün (İstanbul) kabul edilir', async () => {
    await adminCreateSaha(body('2026-10-20'));

    expect(mockInserts).toHaveLength(1);
  });

  test('gelecek tarih kabul edilir', async () => {
    await adminCreateSaha(body('2026-11-05'));

    expect(mockInserts).toHaveLength(1);
  });
});

describe('trainings.service — adminUpdateSaha geçmiş tarih', () => {
  beforeEach(() => {
    mockInserts.length = 0;
    mockUpdates.length = 0;
    mockState.existing = { id: 's1', start_date: '2026-10-15' };
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-10-19T21:30:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
    mockState.existing = undefined;
  });

  test('tarihi geçmiş bir güne taşımak reddedilir', async () => {
    await expect(adminUpdateSaha('s1', { startDate: new Date('2026-10-18') })).rejects.toMatchObject({
      status: 400,
      code: 'start_date_past',
    });
    expect(mockUpdates).toHaveLength(0);
  });

  test('tarihi zaten geçmiş eğitimin başka alanları düzenlenebilir', async () => {
    await adminUpdateSaha('s1', { title: 'Yeni ad', startDate: new Date('2026-10-15') });

    expect(mockUpdates).toHaveLength(1);
  });

  test('tarih ileri bir güne taşınabilir', async () => {
    await adminUpdateSaha('s1', { startDate: new Date('2026-10-20') });

    expect(mockUpdates).toHaveLength(1);
  });
});

describe('trainings.service — saat bilgili tarih İstanbul gününe göre okunur', () => {
  beforeEach(() => {
    mockInserts.length = 0;
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-10-19T21:30:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  test("'2026-10-20T01:00:00+03:00' bugündür, kabul edilir ve aynı gün kaydedilir", async () => {
    await adminCreateSaha(body('2026-10-20T01:00:00+03:00'));

    expect(mockInserts).toHaveLength(1);
    expect(mockInserts[0].start_date).toBe('2026-10-20');
  });

  test('düzenlemede saat bilgili tarih de İstanbul günü olarak kaydedilir', async () => {
    mockState.existing = { id: 's1', start_date: '2026-10-15' };
    mockUpdates.length = 0;

    await adminUpdateSaha('s1', { startDate: new Date('2026-10-25T01:00:00+03:00') });

    expect(mockUpdates[0].start_date).toBe('2026-10-25');
    mockState.existing = undefined;
  });
});
