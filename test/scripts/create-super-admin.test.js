'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

jest.mock('bcrypt', () => require('../modules/admin/panel-fakes').fakeBcrypt);
jest.mock('../../src/config/db', () => ({ db: require('../modules/admin/panel-fakes').createFakeDb() }));
jest.mock('../../src/config/redis', () => ({ redis: {} }));

const { db } = require('../../src/config/db');
const auth = require('../../src/modules/admin/auth/panelAuth.service');
const { createSuperAdmin, generateTempPassword, ALPHABET } = require('../../scripts/create-super-admin');

const EMAIL = 'superadmin@ogm.gov.tr';

beforeEach(() => db.reset({ panel_users: [], panel_refresh_tokens: [], panel_user_audit: [] }));

describe('create-super-admin', () => {
  it('yoksa aktif, gömülü, şifre değiştirmesi zorunlu süper admin oluşturur', async () => {
    const result = await createSuperAdmin({ db, auth, email: '  SuperAdmin@ogm.gov.tr ' });

    expect(result.status).toBe('created');
    const [row] = db.rows('panel_users');
    expect(row).toMatchObject({
      id: result.id,
      name: 'Sistem Yöneticisi',
      email: EMAIL,
      role: 'super_admin',
      status: 'active',
      is_system: true,
      must_change_password: true,
      password_hash: `hash:${result.password}`,
    });
    expect(result.password).toHaveLength(20);
    expect([...result.password].every((c) => ALPHABET.includes(c))).toBe(true);
    expect(db.rows('panel_user_audit')).toContainEqual(
      expect.objectContaining({ target_id: result.id, action: 'auth.super_admin_create' }),
    );
  });

  it('--name verilirse onu kullanır', async () => {
    await createSuperAdmin({ db, auth, email: EMAIL, name: 'Umut Gül' });
    expect(db.rows('panel_users')[0].name).toBe('Umut Gül');
  });

  it('varsa --reset olmadan hiçbir şeyi değiştirmez', async () => {
    const { id } = await createSuperAdmin({ db, auth, email: EMAIL });
    const before = { ...db.rows('panel_users')[0] };

    const result = await createSuperAdmin({ db, auth, email: EMAIL });

    expect(result).toEqual({ status: 'exists', id });
    expect(result).not.toHaveProperty('password');
    expect(db.rows('panel_users')).toEqual([before]);
  });

  it('--reset yeni geçici şifre verir, hesabı aktifler, tüm oturumları kapatır', async () => {
    db.reset({
      panel_users: [{
        id: 'p1', email: EMAIL, role: 'super_admin', status: 'disabled', must_change_password: false, password_hash: 'hash:eski',
      }],
      panel_refresh_tokens: [
        { id: 't1', user_id: 'p1', token_hash: 'a', revoked_at: null },
        { id: 't2', user_id: 'p1', token_hash: 'b', revoked_at: null },
      ],
      panel_user_audit: [],
    });

    const result = await createSuperAdmin({ db, auth, email: EMAIL, reset: true });

    expect(result.status).toBe('reset');
    expect(db.rows('panel_users')[0]).toMatchObject({
      role: 'super_admin',
      status: 'active',
      must_change_password: true,
      password_hash: `hash:${result.password}`,
    });
    expect(db.rows('panel_refresh_tokens').every((t) => t.revoked_at instanceof Date)).toBe(true);
    expect(db.rows('panel_user_audit')).toContainEqual(
      expect.objectContaining({ target_id: 'p1', action: 'auth.super_admin_reset' }),
    );
  });

  it('--reset panelden düşürülüp pasifleştirilmiş gömülü hesabı süper admin olarak geri getirir', async () => {
    db.reset({
      panel_users: [{ id: 'sys', email: EMAIL, role: 'admin', status: 'disabled', is_system: true, password_hash: 'hash:eski' }],
      panel_refresh_tokens: [],
      panel_user_audit: [],
    });

    const result = await createSuperAdmin({ db, auth, email: EMAIL, reset: true });

    expect(result.status).toBe('reset');
    expect(db.rows('panel_users')[0]).toMatchObject({ role: 'super_admin', status: 'active', must_change_password: true });
  });

  it('--reset süper admin olmayan hesabı değiştirmez', async () => {
    db.reset({
      panel_users: [{ id: 'p1', email: EMAIL, role: 'admin', status: 'rejected', password_hash: 'hash:eski' }],
      panel_refresh_tokens: [],
      panel_user_audit: [],
    });
    const before = { ...db.rows('panel_users')[0] };

    await expect(createSuperAdmin({ db, auth, email: EMAIL, reset: true })).rejects.toThrow('rol: admin');
    expect(db.rows('panel_users')).toEqual([before]);
    expect(db.rows('panel_user_audit')).toHaveLength(0);
  });

  it('geçersiz e-postayı reddeder', async () => {
    await expect(createSuperAdmin({ db, auth, email: 'gecersiz' })).rejects.toThrow('--email');
    expect(db.rows('panel_users')).toHaveLength(0);
  });

  it('CLI --email olmadan 1 koduyla çıkar ve hatayı stderr\'e yazar', () => {
    const res = spawnSync(process.execPath, [path.join(__dirname, '../../scripts/create-super-admin.js')], {
      encoding: 'utf8',
    });

    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Süper admin oluşturulamadı: --email gerekli');
  });

  it('geçici şifre her çağrıda farklıdır', () => {
    const set = new Set(Array.from({ length: 50 }, () => generateTempPassword()));
    expect(set.size).toBe(50);
  });
});
