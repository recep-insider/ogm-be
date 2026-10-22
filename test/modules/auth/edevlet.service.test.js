'use strict';

// e-Devlet callback CSRF state kontrolü: gerçek modda state zorunlu; mock modda eksik state
// (yayındaki mobil v1.3) uyarıyla kabul edilir. Gönderilen state her modda eşleşmelidir.

jest.mock('bcrypt', () => require('../admin/panel-fakes').fakeBcrypt);
jest.mock('../../../src/config/db', () => ({ db: require('../admin/panel-fakes').createFakeDb() }));
jest.mock('../../../src/config/redis', () => ({ redis: require('../admin/panel-fakes').createFakeRedis() }));
jest.mock('../../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('axios');

const axios = require('axios');
const env = require('../../../src/config/env');
const logger = require('../../../src/config/logger');
const { db } = require('../../../src/config/db');
const { redis } = require('../../../src/config/redis');
const service = require('../../../src/modules/auth/edevlet.service');
const { callbackSchema } = require('../../../src/modules/auth/edevlet.validators');

const SESSION_ID = '6f1c1d2e-8a4b-4c3d-9e5f-0a1b2c3d4e5f';
const SESSION_KEY = `edevlet:session:${SESSION_ID}`;

beforeEach(() => {
  jest.clearAllMocks();
  db.reset({ users: [] });
  redis.store.clear();
  redis.store.set(SESSION_KEY, { value: JSON.stringify({ state: 'dogru-state' }), expiresAt: null });
});

describe('edevlet.service — callback state (gerçek mod)', () => {
  beforeEach(() => {
    env.edevlet.mockMode = false;
  });

  test.each([['eksik', undefined], ['boş', '']])('%s state 400 validation_error ile reddedilir', async (_label, state) => {
    await expect(service.callback({ sessionId: SESSION_ID, code: 'c', state })).rejects.toMatchObject({
      status: 400, code: 'validation_error',
    });
    expect(redis.store.has(SESSION_KEY)).toBe(true);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('farklı state 400 invalid_oauth_code ile reddedilir, e-Devlet çağrılmaz', async () => {
    await expect(service.callback({ sessionId: SESSION_ID, code: 'c', state: 'baska-state' })).rejects.toMatchObject({
      status: 400, code: 'invalid_oauth_code',
    });
    expect(redis.store.has(SESSION_KEY)).toBe(true);
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('edevlet.service — callback state (mock mod)', () => {
  beforeEach(() => {
    env.edevlet.mockMode = true;
  });

  test('farklı state 400 invalid_oauth_code ile reddedilir, oturum korunur', async () => {
    await expect(service.callback({ sessionId: SESSION_ID, code: 'c', state: 'baska-state' })).rejects.toMatchObject({
      status: 400, code: 'invalid_oauth_code',
    });
    expect(redis.store.has(SESSION_KEY)).toBe(true);
  });

  test('eksik state uyarı loglanarak kabul edilir (mobil v1.3 uyumu)', async () => {
    const res = await service.callback({ sessionId: SESSION_ID, code: 'c' });

    expect(res.isExisting).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith('e-Devlet callback state olmadan geldi (mock mod)');
    expect(redis.store.has(SESSION_KEY)).toBe(false);
  });

  test('eşleşen state ile akış uyarısız sürer ve oturum tüketilir', async () => {
    const res = await service.callback({ sessionId: SESSION_ID, code: 'c', state: 'dogru-state' });

    expect(res.isExisting).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(redis.store.has(SESSION_KEY)).toBe(false);
  });
});

describe('edevlet.validators — callbackSchema', () => {
  test('state opsiyonel (mod kontrolü serviste), gönderilirse boş olamaz', () => {
    expect(callbackSchema.validate({ sessionId: SESSION_ID, code: 'c' }).error).toBeUndefined();
    expect(callbackSchema.validate({ sessionId: SESSION_ID, code: 'c', state: '' }).error.details[0].path).toEqual(['state']);
  });
});
