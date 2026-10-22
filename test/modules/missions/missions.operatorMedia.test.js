'use strict';

// Operatör medyası: panelden eklenen fotoğraf/video moderasyonsuz onaylı yazılır; yalnız
// operatör yüklemesi silinir, gönüllü yüklemesi moderasyonla reddedilir.

const mockState = { mission: null, photo: null, rows: [], inserts: [], deletes: [], chains: [], insertError: null };

jest.mock('../../../src/config/db', () => {
  const makeChain = (table) => {
    const calls = [];
    const c = { table, calls };
    mockState.chains.push(c);
    for (const name of ['where', 'leftJoin', 'select', 'orderBy']) {
      c[name] = jest.fn((...args) => {
        calls.push([name, ...args]);
        return c;
      });
    }
    c.first = jest.fn(async () => (table === 'missions' ? mockState.mission : mockState.photo));
    c.insert = jest.fn(async (row) => {
      if (mockState.insertError) throw mockState.insertError;
      mockState.inserts.push({ table, row });
      return [1];
    });
    c.del = jest.fn(async () => {
      mockState.deletes.push({ table, calls: [...calls] });
      return 1;
    });
    c.then = (resolve, reject) => Promise.resolve(mockState.rows).then(resolve, reject);
    return c;
  };
  const db = Object.assign(jest.fn((table) => makeChain(table)), { raw: jest.fn((sql) => sql) });
  return { db };
});
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/shared/push-provider', () => ({ sendPushToUser: jest.fn() }));
jest.mock('../../../src/modules/users/readiness.service', () => ({ getReadiness: jest.fn() }));

const fs = require('fs');
const path = require('path');
const env = require('../../../src/config/env');
const { writeAudit } = require('../../../src/shared/audit');
const service = require('../../../src/modules/missions/missions.service');

const actor = { userId: 'p1', name: 'Ayşe Operatör', ip: '10.0.0.1', userAgent: 'jest' };
const fileOf = (name, mimetype) => ({ path: path.join(env.upload.dir, 'missions', name), mimetype });

beforeEach(() => {
  mockState.mission = { id: 'm1', status: 'active' };
  mockState.photo = null;
  mockState.rows = [];
  mockState.inserts = [];
  mockState.deletes = [];
  mockState.chains = [];
  mockState.insertError = null;
  env.upload.publicBaseUrl = 'https://api.test';
  jest.clearAllMocks();
  jest.spyOn(fs, 'unlink').mockImplementation((_p, cb) => cb && cb(null));
});

afterEach(() => jest.restoreAllMocks());

describe('adminAddMedia', () => {
  it('onaylı, gönüllüsüz ve operatörün incelemesiyle yazar; öğeyi döner', async () => {
    const result = await service.adminAddMedia('m1', fileOf('a.jpg', 'image/jpeg'), actor);

    const [{ table, row }] = mockState.inserts;
    expect(table).toBe('mission_photos');
    expect(row).toMatchObject({
      mission_id: 'm1',
      user_id: null,
      panel_user_id: 'p1',
      file_path: path.join('missions', 'a.jpg'),
      kind: 'image',
      status: 'approved',
      reviewed_by: 'p1',
    });
    expect(row.reviewed_at).toEqual(row.submitted_at);
    expect(result).toEqual({
      id: row.id,
      kind: 'image',
      url: 'https://api.test/missions/a.jpg',
      status: 'approved',
      uploadedAt: row.submitted_at.toISOString(),
      uploadedBy: { id: 'p1', name: 'Ayşe Operatör' },
    });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'p1', action: 'missions.media.add', entityId: row.id, payload: { missionId: 'm1', kind: 'image' } }),
    );
  });

  it('video mime türü video olarak yazılır', async () => {
    const result = await service.adminAddMedia('m1', fileOf('b.mp4', 'video/mp4'), actor);

    expect(result.kind).toBe('video');
    expect(mockState.inserts[0].row.kind).toBe('video');
  });

  it('dosya yoksa doğrulama hatası', async () => {
    await expect(service.adminAddMedia('m1', undefined, actor)).rejects.toMatchObject({ code: 'validation_error' });
    expect(mockState.inserts).toEqual([]);
  });

  it('olay yoksa 404, yüklenen dosya silinir', async () => {
    mockState.mission = undefined;
    const file = fileOf('c.jpg', 'image/jpeg');

    await expect(service.adminAddMedia('mx', file, actor)).rejects.toMatchObject({ status: 404, code: 'mission_not_found' });
    expect(fs.unlink).toHaveBeenCalledWith(file.path, expect.any(Function));
    expect(mockState.inserts).toEqual([]);
  });

  it('kayıt yazılamazsa yüklenen dosya silinir ve hata yükselir', async () => {
    mockState.insertError = new Error('ER_LOCK_WAIT_TIMEOUT');
    const file = fileOf('e.mp4', 'video/mp4');

    await expect(service.adminAddMedia('m1', file, actor)).rejects.toThrow('ER_LOCK_WAIT_TIMEOUT');
    expect(fs.unlink).toHaveBeenCalledWith(file.path, expect.any(Function));
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('arşivlenmiş olaya eklenemez — 409, yüklenen dosya silinir', async () => {
    mockState.mission = { id: 'm1', status: 'archived' };
    const file = fileOf('d.jpg', 'image/jpeg');

    await expect(service.adminAddMedia('m1', file, actor)).rejects.toMatchObject({ status: 409, code: 'mission_archived' });
    expect(fs.unlink).toHaveBeenCalledWith(file.path, expect.any(Function));
    expect(mockState.inserts).toEqual([]);
  });
});

describe('adminDeleteMedia', () => {
  it('operatör medyasının kaydını ve dosyasını siler', async () => {
    mockState.photo = { id: 'op1', mission_id: 'm1', user_id: null, panel_user_id: 'p1', file_path: 'missions/op.jpg', kind: 'image' };

    await service.adminDeleteMedia('m1', 'op1', actor);

    expect(mockState.deletes).toEqual([{ table: 'mission_photos', calls: [['where', { id: 'op1' }]] }]);
    expect(fs.unlink).toHaveBeenCalledWith(path.join(env.upload.dir, 'missions/op.jpg'), expect.any(Function));
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'missions.media.delete', entityId: 'op1', payload: { missionId: 'm1', kind: 'image' } }),
    );
  });

  it('yükleyen panel kullanıcısı kaldırılmış operatör medyası da silinir', async () => {
    mockState.photo = { id: 'op2', mission_id: 'm1', user_id: null, panel_user_id: null, file_path: 'missions/x.jpg', kind: 'image' };

    await service.adminDeleteMedia('m1', 'op2', actor);

    expect(mockState.deletes).toHaveLength(1);
  });

  it('gönüllü yüklemesi silinmez — 409 volunteer_media', async () => {
    mockState.photo = { id: 'v1', mission_id: 'm1', user_id: 'u1', panel_user_id: null, file_path: 'missions/v.jpg', kind: 'image' };

    await expect(service.adminDeleteMedia('m1', 'v1', actor)).rejects.toMatchObject({ status: 409, code: 'volunteer_media' });
    expect(mockState.deletes).toEqual([]);
    expect(fs.unlink).not.toHaveBeenCalled();
  });

  it('başka olayın ya da olmayan medya 404', async () => {
    await expect(service.adminDeleteMedia('m1', 'yok', actor)).rejects.toMatchObject({ status: 404, code: 'not_found' });
    const [lookup] = mockState.chains;
    expect(lookup.calls).toEqual([['where', { id: 'yok', mission_id: 'm1' }]]);
  });
});

describe('adminListPhotos — iki kaynak', () => {
  it('operatör satırı source=operator, user null ve uploadedBy ile döner', async () => {
    mockState.mission = { id: 'm1', title: 'Marmaris' };
    mockState.rows = [
      { id: 'op1', kind: 'image', status: 'approved', file_path: 'missions/op.jpg', user_id: null, panel_user_id: 'p1', panel_user_name: 'Ayşe Operatör' },
      { id: 'v1', kind: 'video', status: 'pending', file_path: 'missions/v.mp4', user_id: 'u1', user_ad: 'Ali', user_soyad: 'Kaya', panel_user_id: null },
    ];

    const { items } = await service.adminListPhotos('m1');

    expect(items[0]).toMatchObject({ submissionId: 'op1', source: 'operator', user: null, uploadedBy: { id: 'p1', name: 'Ayşe Operatör' } });
    expect(items[1]).toMatchObject({ submissionId: 'v1', source: 'volunteer', user: { userId: 'u1', ad: 'Ali', soyad: 'Kaya' }, uploadedBy: null });
    const list = mockState.chains.find((c) => c.table === 'mission_photos as mp');
    expect(list.calls.filter(([n]) => n === 'leftJoin')).toEqual([
      ['leftJoin', 'users as u', 'u.id', 'mp.user_id'],
      ['leftJoin', 'panel_users as pu', 'pu.id', 'mp.panel_user_id'],
    ]);
  });
});
