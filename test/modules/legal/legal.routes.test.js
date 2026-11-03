'use strict';

// BUG-044: prototip anahtarları (constructor, toString, __proto__) belge sayılmaz.

const express = require('express');
const request = require('supertest');
const legalRouter = require('../../../src/modules/legal/legal.routes');

const app = express();
app.use('/legal', legalRouter);

describe('GET /legal/:document', () => {
  it('yayımlanan belge döner', async () => {
    const res = await request(app).get('/legal/kvkk');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('v1.0');
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])('%s → 404', async (key) => {
    const res = await request(app).get(`/legal/${key}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});
