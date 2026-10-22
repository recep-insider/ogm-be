'use strict';

// e-Devlet callback'inde CSRF state kontrolü atlanamaz: eksik ya da farklı state reddedilir.

jest.mock('bcrypt', () => require('../admin/panel-fakes').fakeBcrypt);
jest.mock('../../../src/config/db', () => ({ db: require('../admin/panel-fakes').createFakeDb() }));
jest.mock('../../../src/config/redis', () => ({ redis: require('../admin/panel-fakes').createFakeRedis() }));

const env = require('../../../src/config/env');
const { db } = require('../../../src/config/db');
const { redis } = require('../../../src/config/redis');
const service = require('../../../src/modules/auth/edevlet.service');
const { callbackSchema } = require('../../../src/modules/auth/edevlet.validators');

const SESSION_ID = '6f1c1d2e-8a4b-4c3d-9e5f-0a1b2c3d4e5f';

beforeEach(() => {
  env.edevlet.mockMode = true;
  db.reset({ users: [] });
  redis.store.clear();
  redis.store.set(`edevlet:session:${SESSION_ID}`, { value: JSON.stringify({ state: 'dogru-state' }), expiresAt: null });
});

describe('edevlet.service — callback state', () => {
  test.each([
    ['eksik', undefined],
    ['boş', ''],
    ['farklı', 'baska-state'],
  ])('%s state 400 invalid_oauth_code ile reddedilir, oturum korunur', async (_label, state) => {
    await expect(service.callback({ sessionId: SESSION_ID, code: 'c', state })).rejects.toMatchObject({
      status: 400, code: 'invalid_oauth_code',
    });
    expect(redis.store.has(`edevlet:session:${SESSION_ID}`)).toBe(true);
  });

  test('eşleşen state ile akış sürer ve oturum tüketilir', async () => {
    const res = await service.callback({ sessionId: SESSION_ID, code: 'c', state: 'dogru-state' });

    expect(res.isExisting).toBe(false);
    expect(redis.store.has(`edevlet:session:${SESSION_ID}`)).toBe(false);
  });
});

describe('edevlet.validators — callbackSchema', () => {
  test('state zorunludur', () => {
    const { error } = callbackSchema.validate({ sessionId: SESSION_ID, code: 'c' });
    expect(error.details[0].path).toEqual(['state']);
    expect(callbackSchema.validate({ sessionId: SESSION_ID, code: 'c', state: 's' }).error).toBeUndefined();
  });
});
