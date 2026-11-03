'use strict';

jest.mock('../../../src/config/db', () => ({ db: require('../admin/panel-fakes').createFakeDb() }));
jest.mock('../../../src/config/redis', () => ({ redis: require('../admin/panel-fakes').createFakeRedis() }));
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
// A55: bildirimdeki süre anonimleştirme sabitinden gelir; sabitten farklı bir değerle doğrulanır.
jest.mock('../../../src/modules/users/anonymize.service', () => ({
  ...jest.requireActual('../../../src/modules/users/anonymize.service'),
  ANONYMIZE_AFTER_DAYS: 45,
}));

const { db } = require('../../../src/config/db');
const { redis } = require('../../../src/config/redis');
const logger = require('../../../src/config/logger');
const { softDelete } = require('../../../src/modules/users/users.service');
const { accessTokenSeconds, userBlockKey } = require('../../../src/shared/jwt');

function seed() {
  db.reset({
    users: [{ id: 'u1', is_active: true, deleted_at: null }],
    refresh_tokens: [{ id: 'r1', user_id: 'u1', revoked_at: null }],
    devices: [{ id: 'd1', user_id: 'u1' }],
  });
  redis.store.clear();
}

afterEach(() => jest.restoreAllMocks());

describe('users.service softDelete', () => {
  it('access token ömrü kadar erişim engeli yazar, refresh token\'ları iptal eder', async () => {
    seed();
    await softDelete('u1');

    expect(await redis.get(userBlockKey('u1'))).toBe('1');
    expect(await redis.ttl(userBlockKey('u1'))).toBe(accessTokenSeconds());
    expect(db.rows('refresh_tokens')[0].revoked_at).toBeInstanceOf(Date);
    expect(db.rows('devices')).toHaveLength(0);
  });

  it('silme süresi ve KVKK notu anonimleştirme süresinden türetilir', async () => {
    seed();
    const res = await softDelete('u1');

    expect(res.purgeAfterDays).toBe(45);
    expect(res.note).toContain('45 gün sonra');
  });

  it('Redis yazılamazsa silme yine tamamlanır ve uyarı loglanır', async () => {
    seed();
    jest.spyOn(redis, 'set').mockRejectedValue(new Error('Connection is closed'));
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    await expect(softDelete('u1')).resolves.toMatchObject({ ok: true });
    expect(db.rows('users')[0].is_active).toBe(false);
    expect(warn).toHaveBeenCalledWith('Silinen hesabın erişim engeli yazılamadı', expect.objectContaining({ userId: 'u1' }));
  });
});
