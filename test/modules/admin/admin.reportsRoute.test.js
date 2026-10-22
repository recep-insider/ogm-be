'use strict';

// GET /admin/reports/summary|series — region parametresi diğer admin uçlarıyla aynı
// kuralla (bölge anahtarı | all) doğrulanır ve servise aynen geçer.

jest.mock('../../../src/middlewares/auth', () => ({
  requireAdmin: (_req, _res, next) => next(),
  requireAuth: (_req, _res, next) => next(),
}));
jest.mock('../../../src/modules/admin/admin.service', () => ({
  ...jest.requireActual('../../../src/modules/admin/admin.service'),
  reportsSummary: jest.fn(async () => ({ ok: true })),
  reportsSeries: jest.fn(async () => ({ ok: true })),
}));

const express = require('express');
const adminService = require('../../../src/modules/admin/admin.service');
const adminRouter = require('../../../src/modules/admin/admin.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');

const RANGE = 'from=2026-06-01T00:00:00Z&to=2026-07-01T00:00:00Z';

describe('GET /admin/reports/* — region', () => {
  let server;
  let base;

  beforeAll(async () => {
    const app = express();
    app.use('/admin', adminRouter);
    app.use(errorHandler);
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}/admin/reports`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  beforeEach(() => jest.clearAllMocks());

  test.each([['ege'], ['all']])('summary region=%s kabul edilir ve servise geçer', async (region) => {
    const res = await fetch(`${base}/summary?${RANGE}&region=${region}`);

    expect(res.status).toBe(200);
    expect(adminService.reportsSummary).toHaveBeenCalledWith(expect.objectContaining({ region }));
  });

  test('summary bilinmeyen bölgeyi 400 ile reddeder', async () => {
    const res = await fetch(`${base}/summary?${RANGE}&region=atlantis`);

    expect(res.status).toBe(400);
    expect(adminService.reportsSummary).not.toHaveBeenCalled();
  });

  test('series region=ege kabul edilir ve servise geçer', async () => {
    const res = await fetch(`${base}/series?metric=missions&interval=day&${RANGE}&region=ege`);

    expect(res.status).toBe(200);
    expect(adminService.reportsSeries).toHaveBeenCalledWith(expect.objectContaining({ metric: 'missions', region: 'ege' }));
  });

  test('series bilinmeyen bölgeyi 400 ile reddeder', async () => {
    const res = await fetch(`${base}/series?metric=missions&interval=day&${RANGE}&region=atlantis`);

    expect(res.status).toBe(400);
    expect(adminService.reportsSeries).not.toHaveBeenCalled();
  });
});
