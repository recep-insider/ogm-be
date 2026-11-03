'use strict';

// BUG-046: kimliksiz /health/ready bileşen durumunu döner; iç hata metni yanıta girmez, loga yazılır.

jest.mock('../../../src/config/db', () => ({ pingDb: jest.fn() }));
jest.mock('../../../src/config/redis', () => ({ pingRedis: jest.fn() }));
jest.mock('../../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { pingDb } = require('../../../src/config/db');
const { pingRedis } = require('../../../src/config/redis');
const logger = require('../../../src/config/logger');
const healthRouter = require('../../../src/modules/health/health.routes');

const app = express();
app.use('/health', healthRouter);

const INTERNAL = 'connect ECONNREFUSED fd00:dead:beef::12:3306';

beforeEach(() => jest.clearAllMocks());

describe('GET /health/ready', () => {
  it('bileşenler ayaktaysa 200 ok', async () => {
    pingDb.mockResolvedValue();
    pingRedis.mockResolvedValue();
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('MySQL düşükse 503, yanıtta hata metni yok, metin logda', async () => {
    pingDb.mockRejectedValue(new Error(INTERNAL));
    pingRedis.mockRejectedValue(new Error('Connection is closed.'));

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual([
      { name: 'mysql', status: 'down', latencyMs: expect.any(Number) },
      { name: 'redis', status: 'down', latencyMs: expect.any(Number) },
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|fd00|Connection is closed/);
    expect(logger.warn).toHaveBeenCalledWith('Hazırlık kontrolü başarısız', { component: 'mysql', error: INTERNAL });
  });
});
