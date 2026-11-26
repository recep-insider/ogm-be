'use strict';

const mockState = { users: [], events: [] };

jest.mock('../../../src/config/db', () => {
  const db = jest.fn(() => ({
    where: (cond) => ({ first: async () => mockState.users.find((u) => u.id === cond.id) }),
    insert: (rows) => ({
      onConflict: (cols) => ({
        ignore: async () => {
          for (const row of rows) {
            const dup = mockState.events.some((e) => cols.every((k) => e[k] === row[k]));
            if (!dup) mockState.events.push(row);
          }
        },
      }),
    }),
  }));
  return { db };
});

const express = require('express');
const request = require('supertest');
const router = require('../../../src/modules/admin/uatEvents/uatEvents.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');
const { signPanelAccessToken } = require('../../../src/shared/jwt');

const app = express();
app.use(express.json());
app.use('/v1/admin/uat-events', router);
app.use(errorHandler);
const server = app.listen(0);
afterAll(() => new Promise((done) => server.close(done)));

const TOKEN = signPanelAccessToken({ sub: 'u1', role: 'admin' });
const EVENT = {
  seq: 0,
  at: 1764151234567,
  type: 'click',
  page: 'yangin/olay/:id',
  context: 'Dialog: Olay Düzenle',
  target: 'button|Kaydet',
  detail: { value: 'secret', code: 'x' },
};

const post = (body, token = TOKEN) => {
  const req = request(server).post('/v1/admin/uat-events');
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.send(body);
};

beforeEach(() => {
  mockState.users = [{ id: 'u1', status: 'active', role: 'admin', token_version: 0, must_change_password: false }];
  mockState.events = [];
});

describe('POST /v1/admin/uat-events', () => {
  it('rejects without token', async () => {
    const res = await post({ sessionId: 's1', events: [EVENT] }, null);

    expect(res.status).toBe(403);
    expect(mockState.events).toEqual([]);
  });

  it("stores events under the token's user", async () => {
    const res = await post({ sessionId: 's1', events: [EVENT] });

    expect(res.status).toBe(204);
    expect(mockState.events).toHaveLength(1);
    const [row] = mockState.events;
    expect(row).toMatchObject({
      panel_user_id: 'u1',
      session_id: 's1',
      seq: 0,
      client_ts: EVENT.at,
      type: 'click',
      page: 'yangin/olay/:id',
      context: 'Dialog: Olay Düzenle',
      target: 'button|Kaydet',
    });
    expect(row.detail).toBe('{"code":"x"}');
  });

  it('stores missing page, context, target and detail as null', async () => {
    const res = await post({ sessionId: 's1', events: [{ seq: 0, at: EVENT.at, type: 'page_view' }] });

    expect(res.status).toBe(204);
    const [row] = mockState.events;
    expect(row.page).toBeNull();
    expect(row.context).toBeNull();
    expect(row.target).toBeNull();
    expect(row.detail).toBeNull();
  });

  it('rejects an unknown type', async () => {
    const res = await post({ sessionId: 's1', events: [{ ...EVENT, type: 'keypress' }] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(mockState.events).toEqual([]);
  });

  it('rejects a seq that does not fit the unsigned int column', async () => {
    const res = await post({ sessionId: 's1', events: [{ ...EVENT, seq: 4294967296 }] });

    expect(res.status).toBe(400);
    expect(mockState.events).toEqual([]);
  });

  it('rejects more than 200 events', async () => {
    const events = Array.from({ length: 201 }, (_, seq) => ({ ...EVENT, seq }));

    const res = await post({ sessionId: 's1', events });

    expect(res.status).toBe(400);
    expect(mockState.events).toEqual([]);
  });

  it('ignores a duplicate session_id+seq', async () => {
    const body = { sessionId: 's1', events: [EVENT, { ...EVENT, seq: 1 }] };

    expect((await post(body)).status).toBe(204);
    expect(mockState.events).toHaveLength(2);
    expect((await post(body)).status).toBe(204);
    expect(mockState.events).toHaveLength(2);
  });
});
