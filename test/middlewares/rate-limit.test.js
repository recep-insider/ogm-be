'use strict';

jest.mock('../../src/config/env', () => ({ admin: { apiKey: 'admin-key' }, jwt: { accessSecret: 'secret' } }));

const jwt = require('jsonwebtoken');
const express = require('express');
const request = require('supertest');
const { GENERAL_LIMIT, ADMIN_LIMIT } = require('../../src/middlewares/rate-limit');

function buildApp(adminApiKey = 'admin-key') {
  let generalLimiter;
  jest.isolateModules(() => {
    jest.doMock('../../src/config/env', () => ({
      admin: { apiKey: adminApiKey },
      jwt: { accessSecret: 'secret' },
    }));
    ({ generalLimiter } = require('../../src/middlewares/rate-limit'));
  });
  const app = express();
  app.use(generalLimiter);
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  servers.push(server);
  return server;
}

const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
});

async function hit(app, times, headers = {}) {
  const agent = request.agent(app);
  let last;
  for (let i = 0; i < times; i += 1) {
    last = await agent.get('/ping').set(headers);
  }
  return last;
}

describe('generalLimiter', () => {
  it('anahtarsız istekleri dakikada GENERAL_LIMIT ile sınırlar', async () => {
    const app = buildApp();
    expect((await hit(app, GENERAL_LIMIT)).status).toBe(200);
    const blocked = await hit(app, 1);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('rate_limited');
  });

  it('geçerli admin anahtarıyla gelen panel trafiği genel limite takılmaz', async () => {
    const app = buildApp();
    expect((await hit(app, GENERAL_LIMIT + 50, { 'x-api-key': 'admin-key' })).status).toBe(200);
  });

  it('admin trafiği aynı IP\'deki anahtarsız kullanıcıların kotasını tüketmez', async () => {
    const app = buildApp();
    await hit(app, GENERAL_LIMIT + 50, { 'x-api-key': 'admin-key' });
    expect((await hit(app, 1)).status).toBe(200);
  });

  it('yanlış anahtar genel limite tabidir', async () => {
    const app = buildApp();
    const res = await hit(app, GENERAL_LIMIT + 1, { 'x-api-key': 'wrong' });
    expect(res.status).toBe(429);
  });

  it('admin anahtarı tanımlı değilken boş ya da eksik anahtar genel limite tabidir', async () => {
    const app = buildApp('');
    expect((await hit(app, GENERAL_LIMIT + 1, { 'x-api-key': '' })).status).toBe(429);

    const noHeader = buildApp('');
    expect((await hit(noHeader, GENERAL_LIMIT + 1)).status).toBe(429);
  });

  it('admin trafiği dakikada ADMIN_LIMIT ile sınırlıdır', async () => {
    const app = buildApp();
    expect((await hit(app, ADMIN_LIMIT, { 'x-api-key': 'admin-key' })).status).toBe(200);
    const blocked = await hit(app, 1, { 'x-api-key': 'admin-key' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('rate_limited');
  });

  describe('panel token', () => {
    const panelToken = (claims = {}, secret = 'secret') =>
      jwt.sign({ sub: 'p1', role: 'admin', typ: 'panel_access', ...claims }, secret, {
        issuer: 'ogm-gonullu-api',
        audience: 'ogm-panel',
        expiresIn: '5m',
      });

    it('geçerli imzalı panel token\'ı yüksek sayaca girer ve IP kotasını tüketmez', async () => {
      const app = buildApp();
      const auth = { Authorization: `Bearer ${panelToken()}` };
      expect((await hit(app, GENERAL_LIMIT + 50, auth)).status).toBe(200);
      expect((await hit(app, 1)).status).toBe(200);
    });

    it('sayaç kullanıcı başınadır (panel:<sub>)', async () => {
      const app = buildApp();
      await hit(app, ADMIN_LIMIT, { Authorization: `Bearer ${panelToken({ sub: 'p1' })}` });
      expect((await hit(app, 1, { Authorization: `Bearer ${panelToken({ sub: 'p1' })}` })).status).toBe(429);
      expect((await hit(app, 1, { Authorization: `Bearer ${panelToken({ sub: 'p2' })}` })).status).toBe(200);
    });

    it('yanlış imzalı ya da mobil token genel limite tabidir', async () => {
      const forged = buildApp();
      const forgedAuth = { Authorization: `Bearer ${panelToken({}, 'baska-secret')}` };
      expect((await hit(forged, GENERAL_LIMIT + 1, forgedAuth)).status).toBe(429);

      const mobile = buildApp();
      const mobileToken = jwt.sign({ sub: 'u1', role: 'admin', typ: 'access' }, 'secret', { issuer: 'ogm-gonullu-api' });
      expect((await hit(mobile, GENERAL_LIMIT + 1, { Authorization: `Bearer ${mobileToken}` })).status).toBe(429);
    });
  });
});
