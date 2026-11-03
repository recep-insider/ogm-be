'use strict';

// BUG-028: tüm 429 yanıtları bekleme süresini (details.retryAfterSec) taşır.

const express = require('express');
const request = require('supertest');
const rateLimit = require('express-rate-limit');
const { rateLimitHandler } = require('../../src/middlewares/rate-limit');

describe('rateLimitHandler', () => {
  it('express-rate-limit 429 yanıtı retryAfterSec taşır', async () => {
    const app = express();
    app.use(rateLimit({ windowMs: 60 * 1000, limit: 1, standardHeaders: 'draft-7', legacyHeaders: false, handler: rateLimitHandler('Çok sık') }));
    app.get('/', (_req, res) => res.json({ ok: true }));

    await request(app).get('/');
    const res = await request(app).get('/');

    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({ code: 'rate_limited', message: 'Çok sık' });
    expect(res.body.error.details.retryAfterSec).toBeGreaterThan(0);
    expect(res.body.error.details.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it('resetTime yoksa retryAfterSec 60 saniyedir', () => {
    const res = { status: jest.fn(() => res), json: jest.fn() };

    rateLimitHandler('Çok sık')({ rateLimit: {} }, res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'rate_limited', message: 'Çok sık', details: { retryAfterSec: 60 } },
    });
  });

  it('OTP, telefon değiştirme ve e-Devlet sınırları aynı gövdeyi kullanır', () => {
    for (const file of ['auth/phone.routes', 'auth/edevlet.routes', 'users/users.routes']) {
      const src = require('fs').readFileSync(require.resolve(`../../src/modules/${file}`), 'utf8');
      expect(src).not.toMatch(/message: \{ error: \{ code: 'rate_limited'/);
      expect(src).toMatch(/handler: rateLimitHandler\(/);
    }
  });
});
