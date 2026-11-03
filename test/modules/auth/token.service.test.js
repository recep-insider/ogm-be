'use strict';

jest.mock('../../../src/config/db', () => ({ db: require('../admin/panel-fakes').createFakeDb() }));
jest.mock('../../../src/config/redis', () => ({ redis: require('../admin/panel-fakes').createFakeRedis() }));
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));

const crypto = require('crypto');
const { db } = require('../../../src/config/db');
const { redis } = require('../../../src/config/redis');
const { signRefreshToken } = require('../../../src/shared/jwt');
const service = require('../../../src/modules/auth/token.service');

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

function seed() {
  const token = signRefreshToken({ sub: 'u1', jti: 'r1' });
  db.reset({
    refresh_tokens: [{
      id: 'r1', user_id: 'u1', token_hash: sha256(token), revoked_at: null,
      expires_at: new Date(Date.now() + 3600 * 1000),
    }],
  });
  redis.store.clear();
  return token;
}

describe('token.service refresh', () => {
  it('aynı refresh token eşzamanlı iki kez sunulursa yalnız biri yeni zincir alır', async () => {
    const token = seed();

    const results = await Promise.allSettled([
      service.refresh({ refreshToken: token }),
      service.refresh({ refreshToken: token }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [rejected] = results.filter((r) => r.status === 'rejected');
    expect(rejected.reason).toMatchObject({ status: 401 });
  });

  it('tek istek yeni token çifti döner ve eskisini iptal eder', async () => {
    const token = seed();
    const out = await service.refresh({ refreshToken: token });
    expect(out.accessToken).toEqual(expect.any(String));
    expect(db.rows('refresh_tokens').find((r) => r.id === 'r1').revoked_at).toBeTruthy();
  });
});
