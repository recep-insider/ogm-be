'use strict';

// K31 + BUG-039: ana sayfa "Haberler & Duyurular" sabit metin değil, yayımlanan "Haber" yazılarıdır.

const mockCounterWhere = [];

jest.mock('../../../src/config/db', () => {
  const fake = require('../admin/panel-fakes').createFakeDb();
  // Bugünkü ihbar sayacı count kullanır; sorgunun aldığı gün başı mockCounterWhere'de tutulur.
  const counter = { where: (...args) => { mockCounterWhere.push(args); return counter; }, count: () => counter, first: async () => ({ c: 0 }) };
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

describe('home feed — bugünkü ihbar sayısı Türkiye gününe göre (BUG-063)', () => {
  afterEach(() => jest.useRealTimers());

  it('Türkiye saatiyle 01:30\'da gün başı bir önceki UTC gününün 21:00\'idir', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-02T22:30:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
    mockCounterWhere.length = 0;

    await getFeed(null);

    expect(mockCounterWhere[0]).toEqual(['created_at', '>=', new Date('2026-11-02T21:00:00Z')]);
  });
});
