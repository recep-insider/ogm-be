'use strict';

jest.mock('bcrypt', () => require('./panel-fakes').fakeBcrypt);
jest.mock('../../../src/config/db', () => ({ db: require('./panel-fakes').createFakeDb() }));
jest.mock('../../../src/config/redis', () => ({ redis: require('./panel-fakes').createFakeRedis() }));

const crypto = require('crypto');
const { db } = require('../../../src/config/db');
const { redis } = require('../../../src/config/redis');
const logger = require('../../../src/config/logger');
const service = require('../../../src/modules/admin/auth/panelAuth.service');

const PASSWORD = 'dogru-sifre-123';
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

function seed({ tokens = [] } = {}) {
  db.reset({
    panel_users: [{
      id: 'u1', name: 'Ayşe Demir', email: 'ayse@ogm.gov.tr', password_hash: `hash:${PASSWORD}`,
      role: 'admin', status: 'active', must_change_password: false,
    }],
    panel_refresh_tokens: tokens,
    panel_user_audit: [],
  });
  redis.store.clear();
}

afterEach(() => jest.restoreAllMocks());

describe('panelAuth.service refresh', () => {
  it('aynı token eşzamanlı iki kez sunulursa yalnız biri döner, diğeri refresh_reused ve tüm oturumlar kapanır', async () => {
    const future = new Date(Date.now() + 3600 * 1000);
    seed({
      tokens: [
        { id: 't1', user_id: 'u1', token_hash: sha256('ortak'), expires_at: future, revoked_at: null },
        { id: 't2', user_id: 'u1', token_hash: sha256('diger'), expires_at: future, revoked_at: null },
      ],
    });

    const results = await Promise.allSettled([service.refresh('ortak'), service.refresh('ortak')]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.code).toBe('refresh_reused');
    const tokens = db.rows('panel_refresh_tokens');
    expect(tokens).toHaveLength(3);
    expect(tokens.every((t) => t.revoked_at instanceof Date)).toBe(true);
  });
});

describe('panelAuth.service refresh yarışı', () => {
  it('okuma ile rotasyon arasında şifre değişimiyle kapanan token refresh_invalid döner, diğer oturum kalır', async () => {
    const future = new Date(Date.now() + 3600 * 1000);
    seed({
      tokens: [
        { id: 't1', user_id: 'u1', token_hash: sha256('cihaz'), expires_at: future, revoked_at: null },
        { id: 't2', user_id: 'u1', token_hash: sha256('korunan'), expires_at: future, revoked_at: null },
      ],
    });
    // Kullanıcı okunurken t1'i kapatmak, eşzamanlı bir changePassword'ün araya girmesini taklit eder.
    const [t1] = db.rows('panel_refresh_tokens');
    const [userRow] = db.rows('panel_users');
    Object.defineProperty(userRow, 'status', {
      enumerable: true,
      get() {
        t1.revoked_at = new Date();
        return 'active';
      },
    });

    await expect(service.refresh('cihaz')).rejects.toMatchObject({ code: 'refresh_invalid' });
    expect(db.rows('panel_refresh_tokens').find((t) => t.id === 't2').revoked_at).toBeNull();
    expect(db.rows('panel_user_audit').map((a) => a.action)).not.toContain('auth.refresh_reused');
  });
});

describe('panelAuth.service logout', () => {
  it('iptal edilmiş eski token diğer oturumları kapatmaz', async () => {
    const future = new Date(Date.now() + 3600 * 1000);
    seed({
      tokens: [
        { id: 't1', user_id: 'u1', token_hash: sha256('eski'), expires_at: future, revoked_at: new Date(), replaced_by: 't2' },
        { id: 't2', user_id: 'u1', token_hash: sha256('canli'), expires_at: future, revoked_at: null },
      ],
    });

    await service.logout('eski');

    expect(db.rows('panel_refresh_tokens').find((t) => t.id === 't2').revoked_at).toBeNull();
    expect(db.rows('panel_user_audit')).toHaveLength(0);
  });
});

describe('panelAuth.service writePanelAudit', () => {
  it('audit yazılamazsa giriş yine oturum döner ve uyarı loglanır', async () => {
    seed();
    db.rows('panel_user_audit').push = () => {
      throw new Error('audit tablosu yok');
    };
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    const result = await service.login({ email: 'ayse@ogm.gov.tr', password: PASSWORD });

    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.user.id).toBe('u1');
    expect(warn).toHaveBeenCalledWith(
      'Panel audit yazılamadı',
      expect.objectContaining({ error: 'audit tablosu yok', action: 'auth.login' }),
    );
  });
});
