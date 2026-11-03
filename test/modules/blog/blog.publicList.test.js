'use strict';

// BUG-054 / SG-18: GET /blog/posts sorgusu doğrulanır (dizi category 500 veriyordu); isteğe bağlı sayfalama.

jest.mock('../../../src/config/db', () => ({ db: require('../admin/panel-fakes').createFakeDb() }));

const express = require('express');
const request = require('supertest');
const { db } = require('../../../src/config/db');
const blogRouter = require('../../../src/modules/blog/blog.routes');
const { errorHandler } = require('../../../src/middlewares/error-handler');

const app = express();
app.use('/blog', blogRouter);
app.use(errorHandler);

const post = (id, category, day) => ({ id, title: id, category, is_active: true, published_at: new Date(`2026-10-${day}T09:00:00Z`) });

beforeEach(() => {
  db.reset({ blog_posts: [post('a', 'haber', 10), post('b', 'teknik', 11), post('c', 'haber', 12), { ...post('d', 'haber', 13), is_active: false }] });
});

describe('GET /blog/posts', () => {
  it('parametresiz tüm yayımlanan yazılar, yeniden eskiye', async () => {
    const res = await request(app).get('/blog/posts');
    expect(res.status).toBe(200);
    expect(res.body.map((p) => p.id)).toEqual(['c', 'b', 'a']);
  });

  it('kategori süzer', async () => {
    const res = await request(app).get('/blog/posts?category=haber');
    expect(res.body.map((p) => p.id)).toEqual(['c', 'a']);
  });

  it.each(['category[]=haber', 'category=Haber', 'pageSize=0', 'page=abc'])('%s → 400, 500 değil', async (qs) => {
    const res = await request(app).get(`/blog/posts?${qs}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('pageSize ile sayfalı liste (dizi biçimi aynı)', async () => {
    const res = await request(app).get('/blog/posts?pageSize=2&page=2');
    expect(res.body.map((p) => p.id)).toEqual(['a']);
  });
});
