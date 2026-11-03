'use strict';

// BUG-047: 255 karakteri aşan User-Agent kayıtlara sığacak şekilde kırpılır (giriş ve onay 500 veriyordu).

jest.mock('bcrypt', () => require('../modules/admin/panel-fakes').fakeBcrypt);
jest.mock('../../src/config/db', () => ({ db: require('../modules/admin/panel-fakes').createFakeDb() }));
jest.mock('../../src/config/redis', () => ({ redis: require('../modules/admin/panel-fakes').createFakeRedis() }));
jest.mock('../../src/modules/health/health.controller', () => ({
  liveness: (req, res) => res.json({ ua: req.headers['user-agent'] }),
  readiness: (_req, res) => res.json({}),
}));

const request = require('supertest');
const app = require('../../src/app');
const { capUserAgent, MAX_USER_AGENT } = require('../../src/middlewares/user-agent');

describe('capUserAgent', () => {
  it('uzun User-Agent sütun sınırına kırpılır', () => {
    const req = { headers: { 'user-agent': 'a'.repeat(300) } };
    const next = jest.fn();
    capUserAgent(req, {}, next);
    expect(req.headers['user-agent']).toHaveLength(MAX_USER_AGENT);
    expect(next).toHaveBeenCalled();
  });

  it('kısa ya da olmayan User-Agent değişmez', () => {
    const req = { headers: { 'user-agent': 'okhttp/4.12' } };
    capUserAgent(req, {}, () => {});
    expect(req.headers['user-agent']).toBe('okhttp/4.12');
    const bare = { headers: {} };
    capUserAgent(bare, {}, () => {});
    expect(bare.headers['user-agent']).toBeUndefined();
  });

  it('uygulama tüm isteklerde kırpar', async () => {
    const res = await request(app).get('/health').set('User-Agent', 'b'.repeat(300));
    expect(res.body.ua).toBe('b'.repeat(255));
  });
});
