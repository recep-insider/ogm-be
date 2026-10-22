'use strict';

// getApplicationStatus yalnızca db('applications').where().orderBy().first('status') zincirini
// kullanır; config/db'yi mock'layıp dönen değeri kontrol ediyoruz. bcrypt native binding'i bazı
// makinelerde yüklenemediği için (users.service require zincirinde gelebilir) onu da mock'luyoruz.
jest.mock('bcrypt', () => ({ hash: jest.fn(), compare: jest.fn() }));

const mockFirst = jest.fn();
jest.mock('../../../src/config/db', () => ({
  db: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    first: mockFirst,
  })),
}));

const { getApplicationStatus, profileFields } = require('../../../src/modules/users/users.service');
const { regionForCity } = require('../../../src/shared/regions');

describe('users.service — getApplicationStatus', () => {
  beforeEach(() => {
    mockFirst.mockReset();
  });

  test('en güncel başvurunun status değerini döner', async () => {
    mockFirst.mockResolvedValue({ status: 'approved' });
    await expect(getApplicationStatus('u1')).resolves.toBe('approved');
  });

  test('başvuru yoksa null döner', async () => {
    mockFirst.mockResolvedValue(undefined);
    await expect(getApplicationStatus('u1')).resolves.toBeNull();
  });

  test('applications tablosunu user_id filtresi ve submitted_at desc ile sorgular', async () => {
    const where = jest.fn().mockReturnThis();
    const orderBy = jest.fn().mockReturnThis();
    const { db } = require('../../../src/config/db');
    db.mockReturnValueOnce({ where, orderBy, first: mockFirst });
    mockFirst.mockResolvedValue({ status: 'pending' });

    const result = await getApplicationStatus('user-42');

    expect(result).toBe('pending');
    expect(db).toHaveBeenCalledWith('applications');
    expect(where).toHaveBeenCalledWith({ user_id: 'user-42' });
    expect(orderBy).toHaveBeenCalledWith('submitted_at', 'desc');
  });
});

// Mobil profil (getMe) ve panel künyesi (admin.getVolunteer / liste) bu tek eşlemeyi kullanır.
describe('users.service — profileFields', () => {
  test('profil alanlarını API biçimine çevirir, bölgeyi il\'den türetir', () => {
    const out = profileFields({
      il: 'Muğla', ilce: 'Marmaris', ogrenim: 'lisans', meslek: 'diger', meslek_diger: 'Ormancı',
      giysi_bedeni: 'M', ayakkabi_numarasi: '42', stk_text: 'AKUT',
    });

    expect(out).toEqual({
      il: 'Muğla', ilce: 'Marmaris', region: regionForCity('Muğla'), ogrenim: 'lisans', meslek: 'diger',
      meslekDiger: 'Ormancı', giysiBedeni: 'M', ayakkabiNumarasi: 42, stkText: 'AKUT',
    });
  });

  test('boş alanlar null döner', () => {
    expect(profileFields({ il: '', ilce: undefined, ayakkabi_numarasi: null, stk_text: '' })).toMatchObject({
      il: null, ilce: null, ayakkabiNumarasi: null, stkText: null,
    });
  });
});
