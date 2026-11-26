'use strict';

jest.mock('bcrypt', () => require('./panel-fakes').fakeBcrypt);
jest.mock('../../../src/config/db', () => {
  const fake = require('./panel-fakes').createFakeDb();
  const db = Object.assign((name) => {
    const q = fake(name);
    if (name === 'uat_events') {
      const { insert } = q;
      q.insert = (rows) => ({ onConflict: () => ({ ignore: () => insert(rows) }) });
    }
    return q;
  }, fake);
  return { db };
});
jest.mock('../../../src/config/redis', () => ({ redis: require('./panel-fakes').createFakeRedis() }));
jest.mock('../../../src/middlewares/rate-limit', () => ({
  ...jest.requireActual('../../../src/middlewares/rate-limit'),
  generalLimiter: (_req, _res, next) => next(),
}));

const request = require('supertest');
const { db } = require('../../../src/config/db');
const app = require('../../../src/app');
const { signPanelAccessToken } = require('../../../src/shared/jwt');

const server = app.listen(0);
afterAll(() => new Promise((done) => server.close(done)));

beforeEach(() => {
  db.reset({
    panel_users: [{ id: 'u1', status: 'active', role: 'admin', token_version: 0, must_change_password: false }],
    uat_events: [],
  });
});

describe('POST /v1/admin/uat-events through src/app.js', () => {
  it('stores the batch under the token user', async () => {
    const res = await request(server)
      .post('/v1/admin/uat-events')
      .set('Authorization', `Bearer ${signPanelAccessToken({ sub: 'u1', role: 'admin' })}`)
      .send({ sessionId: 's1', events: [{ seq: 0, at: 1764151234567, type: 'page_view', page: 'yangin' }] });

    expect(res.status).toBe(204);
    expect(db.rows('uat_events')).toEqual([
      expect.objectContaining({ panel_user_id: 'u1', session_id: 's1', seq: 0, type: 'page_view', page: 'yangin' }),
    ]);
  });
});
