'use strict';

// PATCH /users/me — giysiBedeni/ayakkabiNumarasi: snake_case eşlemesi, null ile temizleme
// ve cevabın TAM UserProfile olması (frontend cache'i komple değiştirdiği için kritik).

jest.mock('bcrypt', () => ({ hash: jest.fn(), compare: jest.fn() }));

const mockUpdates = [];
const mockState = { userRow: null };

jest.mock('../../../src/config/db', () => {
  const makeChain = (table) => {
    const c = {
      where: jest.fn(() => c),
      whereNot: jest.fn(() => c),
      orderBy: jest.fn(() => c),
      count: jest.fn(() => c),
      pluck: jest.fn(async () => []),
      first: jest.fn(async () => {
        if (table === 'users') return mockState.userRow;
        if (table === 'user_trainings') return { c: 0 };
        return undefined;
      }),
      update: jest.fn(async (row) => {
        mockUpdates.push(row);
        return 1;
      }),
    };
    return c;
  };
  const db = Object.assign(jest.fn((table) => makeChain(table)), { raw: jest.fn() });
  return { db };
});
jest.mock('../../../src/config/env', () => ({
  upload: { dir: '/tmp/uploads' },
  api: { baseUrl: 'https://api.test' },
}));
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/shared/asset-url', () => ({ assetUrl: () => null }));
jest.mock('../../../src/modules/equipment/equipment.service', () => ({
  hasProtectiveEquipment: jest.fn(async () => false),
}));

const { patchMe, getMe } = require('../../../src/modules/users/users.service');

describe('users.service — giysiBedeni / ayakkabiNumarasi', () => {
  beforeEach(() => {
    mockUpdates.length = 0;
    mockState.userRow = {
      id: 'u1',
      tc_kimlik: '10000000146',
      ad: 'Ali',
      soyad: 'Yılmaz',
      giysi_bedeni: 'M',
      ayakkabi_numarasi: 38,
      profile_complete: 1,
    };
    jest.clearAllMocks();
  });

  test('patchMe camelCase alanları snake_case kolonlara eşler', async () => {
    await patchMe('u1', { giysiBedeni: 'XL', ayakkabiNumarasi: 42 });

    expect(mockUpdates).toHaveLength(1);
    expect(mockUpdates[0].giysi_bedeni).toBe('XL');
    expect(mockUpdates[0].ayakkabi_numarasi).toBe(42);
  });

  test('null gönderilirse alanlar temizlenir', async () => {
    await patchMe('u1', { giysiBedeni: null, ayakkabiNumarasi: null });

    expect(mockUpdates[0].giysi_bedeni).toBeNull();
    expect(mockUpdates[0].ayakkabi_numarasi).toBeNull();
  });

  test('patchMe TAM profil döner ve iki yeni alan cevapta bulunur', async () => {
    const profile = await patchMe('u1', { giysiBedeni: 'L' });

    // Cevap getMe çıktısı: yeni alanlar + mevcut profil alanları birlikte.
    expect(profile.giysiBedeni).toBe('M'); // mockState.userRow'dan okunur (mock sabit)
    expect(profile.ayakkabiNumarasi).toBe(38);
    expect(profile).toHaveProperty('acil');
    expect(profile).toHaveProperty('volunteerLevel');
    expect(profile).toHaveProperty('hobiler');
  });

  test('getMe değer yokken null döner (eski kayıtlar)', async () => {
    mockState.userRow.giysi_bedeni = null;
    mockState.userRow.ayakkabi_numarasi = null;

    const profile = await getMe('u1');
    expect(profile.giysiBedeni).toBeNull();
    expect(profile.ayakkabiNumarasi).toBeNull();
  });
});
