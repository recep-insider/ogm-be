'use strict';

// blog.service admin CRUD için zincirlenebilir knex mock'u (admin-read deseni).
const mockQueue = [];
const mockInsert = jest.fn(() => Promise.resolve());
const mockUpdate = jest.fn(() => Promise.resolve(1));
const mockDel = jest.fn(() => Promise.resolve(1));
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../src/config/db', () => {
  const makeChain = () => {
    const chain = {};
    for (const method of ['where', 'orderBy', 'select']) {
      chain[method] = jest.fn(() => chain);
    }
    chain.insert = (...a) => mockInsert(...a);
    chain.update = (...a) => mockUpdate(...a);
    chain.del = (...a) => mockDel(...a);
    chain.first = jest.fn(() => Promise.resolve(mockQueue.shift()));
    chain.then = (resolve, reject) => Promise.resolve(mockQueue.shift()).then(resolve, reject);
    return chain;
  };
  const dbFn = jest.fn(() => makeChain());
  dbFn.raw = jest.fn((sql) => ({ __raw: sql }));
  dbFn.fn = { now: jest.fn(() => ({ __now: true })) };
  return { db: dbFn };
});
jest.mock('../../../src/shared/audit', () => ({ writeAudit: (...a) => mockWriteAudit(...a) }));
jest.mock('../../../src/shared/asset-url', () => ({
  assetUrl: (rel) => (rel ? `https://cdn.test/${rel}` : null),
}));

const blogService = require('../../../src/modules/blog/blog.service');

const dbRow = {
  id: 'bp_x', title: 'Başlık', description: 'Özet', cover_path: 'content/kapak.jpg',
  published_at: '2026-06-10', read_time_min: 4, themes: '["Eğitim"]',
  author_name: 'Yazar', author_role: null, author_avatar_path: null,
  content: '[{"type":"paragraph","text":"Merhaba"},{"type":"image","source":"content/ic.jpg"}]',
  is_active: 0, created_at: new Date('2026-06-10T10:00:00Z'), updated_at: new Date('2026-06-10T10:00:00Z'),
};

describe('blog.service — admin CRUD', () => {
  beforeEach(() => {
    mockQueue.length = 0;
    mockInsert.mockClear();
    mockUpdate.mockClear();
    mockDel.mockClear();
    mockWriteAudit.mockClear();
  });

  test('adminCreate camelCase body\'yi snake_case satıra çevirir, JSON kolonları stringify eder', async () => {
    mockQueue.push(dbRow); // insert sonrası select first

    await blogService.adminCreate({
      title: 'Başlık', description: 'Özet', coverPath: 'content/kapak.jpg',
      readTimeMin: 4, themes: ['Eğitim'], authorName: 'Yazar',
      content: [{ type: 'paragraph', text: 'Merhaba' }], isActive: false,
    }, { userId: null });

    const inserted = mockInsert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      title: 'Başlık', description: 'Özet', cover_path: 'content/kapak.jpg',
      read_time_min: 4, themes: '["Eğitim"]', author_name: 'Yazar', is_active: false,
    });
    expect(inserted.published_at).toEqual({ __now: true }); // verilmezse DB now() (DATE truncation güvenli)
    expect(typeof inserted.content).toBe('string');
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'blog.create' }));
  });

  test('adminUpdate yalnızca verilen alanları günceller (kısmi PUT)', async () => {
    mockQueue.push(dbRow); // existing first
    mockQueue.push(dbRow); // updated first

    await blogService.adminUpdate('bp_x', { isActive: true }, {});

    const patch = mockUpdate.mock.calls[0][0];
    expect(patch.is_active).toBe(true);
    expect(patch).not.toHaveProperty('title');
    expect(patch.updated_at).toBeInstanceOf(Date);
  });

  test('adminUpdate/adminRemove olmayan kayıtta post_not_found fırlatır', async () => {
    mockQueue.push(undefined);
    await expect(blogService.adminUpdate('yok', { title: 'x' }, {})).rejects.toMatchObject({ code: 'post_not_found' });
    mockQueue.push(undefined);
    await expect(blogService.adminRemove('yok', {})).rejects.toMatchObject({ code: 'post_not_found' });
    expect(mockDel).not.toHaveBeenCalled();
  });

  test('mapAdminPost: ham path + URL birlikte döner (panel roundtrip), taslak isActive=false', () => {
    const dto = blogService.mapAdminPost(dbRow);
    expect(dto.isActive).toBe(false);
    expect(dto.coverPath).toBe('content/kapak.jpg');
    expect(dto.cover).toBe('https://cdn.test/content/kapak.jpg');
    const img = dto.content.find((b) => b.type === 'image');
    expect(img).toMatchObject({ source: 'content/ic.jpg', sourceUrl: 'https://cdn.test/content/ic.jpg' });
  });
});
