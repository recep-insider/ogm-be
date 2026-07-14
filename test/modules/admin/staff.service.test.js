'use strict';

// db / bcrypt / audit are mocked (repo test pattern: unit level, no real DB).

const mockFirst = jest.fn();
const mockInsert = jest.fn().mockResolvedValue([1]);
const mockUpdate = jest.fn().mockResolvedValue(1);
const mockRows = jest.fn().mockResolvedValue([]);

function chain() {
  const c = {
    whereRaw: () => c,
    whereNull: () => c,
    where: () => c,
    orderBy: () => c,
    select: () => c,
    first: (...a) => mockFirst(...a),
    insert: (...a) => mockInsert(...a),
    update: (...a) => mockUpdate(...a),
    // The listStaff chain is awaited directly → make it thenable.
    then: (resolve, reject) => mockRows().then(resolve, reject),
  };
  return c;
}

const mockDb = jest.fn(() => chain());
mockDb.fn = { now: () => 'NOW' };

const mockHash = jest.fn().mockResolvedValue('hashed-pw');
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../src/config/db', () => ({ db: mockDb }));
jest.mock('bcrypt', () => ({ hash: (...a) => mockHash(...a) }));
jest.mock('../../../src/shared/audit', () => ({ writeAudit: (...a) => mockWriteAudit(...a) }));

const staff = require('../../../src/modules/admin/staff.service');

const ACTOR = { userId: 'adm-1', ip: '1.2.3.4', userAgent: 'jest' };

beforeEach(() => {
  jest.clearAllMocks();
  mockInsert.mockResolvedValue([1]);
  mockUpdate.mockResolvedValue(1);
  mockHash.mockResolvedValue('hashed-pw');
  mockRows.mockResolvedValue([]);
});

describe('staff.service — createStaff', () => {
  test('e-posta zaten varsa 409 admin_email_exists', async () => {
    mockFirst.mockResolvedValueOnce({ id: 'x', eposta: 'a@b.com' });
    await expect(
      staff.createStaff({ eposta: 'a@b.com', sifre: 'password1', role: 'officer' }, ACTOR),
    ).rejects.toMatchObject({ status: 409, code: 'admin_email_exists' });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('yeni hesabı bcrypt hash ile yazar ve audit üretir', async () => {
    mockFirst.mockResolvedValueOnce(undefined);
    const res = await staff.createStaff(
      { eposta: 'yeni@ogm.gov.tr', ad: 'Ali', soyad: 'Veli', sifre: 'password1', role: 'officer' },
      ACTOR,
    );

    expect(mockHash).toHaveBeenCalledWith('password1', expect.any(Number));
    const inserted = mockInsert.mock.calls[0][0];
    expect(inserted.password_hash).toBe('hashed-pw');
    expect(inserted.role).toBe('officer');
    expect(res).toMatchObject({ eposta: 'yeni@ogm.gov.tr', role: 'officer', isActive: true });
    expect(res.password_hash).toBeUndefined();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.staff.create', entity: 'admin_user' }),
    );
  });
});

describe('staff.service — updateStaff', () => {
  test('hesap yoksa 404', async () => {
    mockFirst.mockResolvedValueOnce(undefined);
    await expect(
      staff.updateStaff('yok', { isActive: false }, ACTOR),
    ).rejects.toMatchObject({ status: 404, code: 'admin_not_found' });
  });

  test('deaktive edince refresh token da iptal edilir (iki update)', async () => {
    mockFirst.mockResolvedValueOnce({ id: 'adm-2', eposta: 'x@y.com', role: 'officer', is_active: 1 });
    await staff.updateStaff('adm-2', { isActive: false }, ACTOR);
    // 1) admin_users update, 2) admin_refresh_tokens revoke
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.staff.update' }),
    );
  });

  test('rol güncellemede refresh token iptal edilmez (tek update)', async () => {
    mockFirst.mockResolvedValueOnce({ id: 'adm-2', eposta: 'x@y.com', role: 'officer', is_active: 1 });
    await staff.updateStaff('adm-2', { role: 'admin' }, ACTOR);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('staff.service — listStaff', () => {
  test('publicStaff biçiminde döner (is_active → isActive)', async () => {
    mockRows.mockResolvedValueOnce([
      { id: 'a1', eposta: 'a@b.com', ad: 'A', soyad: 'B', role: 'admin', is_active: 1, last_login_at: null, created_at: 'now' },
    ]);
    const list = await staff.listStaff();
    expect(list).toEqual([
      {
        id: 'a1',
        eposta: 'a@b.com',
        ad: 'A',
        soyad: 'B',
        role: 'admin',
        isActive: true,
        lastLoginAt: null,
        createdAt: 'now',
      },
    ]);
  });
});
