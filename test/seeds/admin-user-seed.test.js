'use strict';

// 07_admin_user seed idempotency birim testi: env yoksa no-op, e-posta zaten
// varsa no-op (şifreyi ASLA yeniden yazmaz), aksi halde bcrypt.hash ile insert.
// bcrypt native binding bu makinede yüklenmez → mock'lanır (repo deseni).

const mockHash = jest.fn().mockResolvedValue('hashed-pw');
jest.mock('bcrypt', () => ({ hash: (...a) => mockHash(...a) }));
jest.mock('uuid', () => ({ v4: () => 'fixed-uuid' }));

// env.admin.seed* değerlerini test başına kontrol edebilmek için mutable mock.
const adminEnv = {
  seedEmail: '',
  seedPassword: '',
  seedAd: 'Sistem',
  seedSoyad: 'Yöneticisi',
  bcryptRounds: 12,
};
jest.mock('../../src/config/env', () => ({ admin: adminEnv }));

const { seed } = require('../../seeds/07_admin_user');

function makeKnex({ existing }) {
  const insert = jest.fn().mockResolvedValue([1]);
  const first = jest.fn().mockResolvedValue(existing);
  const chain = { whereRaw: () => chain, first, insert };
  const knex = jest.fn(() => chain);
  return { knex, insert, first };
}

beforeEach(() => {
  jest.clearAllMocks();
  adminEnv.seedEmail = '';
  adminEnv.seedPassword = '';
});

describe('seeds/07_admin_user', () => {
  test('env sağlanmadığında no-op (DB sorgusu ve hash yok)', async () => {
    const { knex, insert } = makeKnex({ existing: undefined });
    await seed(knex);
    expect(knex).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(mockHash).not.toHaveBeenCalled();
  });

  test('yalnızca e-posta varken (şifre yok) no-op', async () => {
    adminEnv.seedEmail = 'admin@ogm.gov.tr';
    const { knex } = makeKnex({ existing: undefined });
    await seed(knex);
    expect(knex).not.toHaveBeenCalled();
  });

  test('e-posta zaten varsa no-op — şifre yeniden yazılmaz (insert yok)', async () => {
    adminEnv.seedEmail = 'admin@ogm.gov.tr';
    adminEnv.seedPassword = 'password1';
    const { knex, insert } = makeKnex({ existing: { id: 'adm-1' } });
    await seed(knex);
    expect(mockHash).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  test('hesap yoksa şifre hash\'lenir ve admin insert edilir', async () => {
    adminEnv.seedEmail = 'admin@ogm.gov.tr';
    adminEnv.seedPassword = 'password1';
    const { knex, insert } = makeKnex({ existing: undefined });
    await seed(knex);

    expect(mockHash).toHaveBeenCalledWith('password1', 12);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'fixed-uuid',
        eposta: 'admin@ogm.gov.tr',
        password_hash: 'hashed-pw',
        role: 'admin',
        is_active: true,
      }),
    );
  });
});
