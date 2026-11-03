'use strict';

// K31 + BUG-039: ana sayfa "Haberler & Duyurular" sabit metin değil, yayımlanan "Haber" yazılarıdır.

jest.mock('../../../src/config/db', () => {
  const fake = require('../admin/panel-fakes').createFakeDb();
  // Bugünkü ihbar sayacı ham SQL kullanır; bu test yalnız haber bölümünü sınar.
  const counter = { whereRaw: () => counter, count: () => counter, first: async () => ({ c: 0 }) };
  const db = Object.assign((table) => (table === 'fire_reports' ? counter : fake(table)), fake);
  return { db };
});
jest.mock('../../../src/shared/asset-url', () => ({ assetUrl: (rel) => (rel ? `https://cdn.test/${rel}` : null) }));

const { db } = require('../../../src/config/db');
const { getFeed } = require('../../../src/modules/home/home.service');

const post = (id, category, publishedAt, extra = {}) => ({
  id, title: id, category, is_active: true, cover_path: `content/${id}.jpg`, published_at: new Date(publishedAt), ...extra,
});

beforeEach(() => {
  db.reset({
    users: [],
    fire_reports: [],
    blog_posts: [
      post('eski-haber', 'haber', '2026-10-01T09:00:00'),
      post('yeni-haber', 'haber', '2026-11-01T09:00:00'),
      post('teknik', 'teknik', '2026-11-02T09:00:00'),
      post('taslak-haber', 'haber', '2026-11-03T09:00:00', { is_active: false }),
    ],
  });
});

describe('home feed — news', () => {
  it('yalnız yayımlanmış haber yazıları yeniden eskiye döner', async () => {
    const feed = await getFeed(null);

    expect(feed.news.map((n) => n.id)).toEqual(['yeni-haber', 'eski-haber']);
    expect(feed.news[0]).toMatchObject({
      type: 'haber', title: 'yeni-haber', imageUrl: 'https://cdn.test/content/yeni-haber.jpg', publishedAt: '2026-11-01', url: null,
    });
  });

  it('haber yoksa liste boş döner', async () => {
    db.reset({ users: [], fire_reports: [], blog_posts: [post('teknik', 'teknik', '2026-11-02T09:00:00')] });
    expect((await getFeed(null)).news).toEqual([]);
  });
});
