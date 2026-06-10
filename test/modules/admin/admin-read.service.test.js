'use strict';

// listVolunteers/getVolunteer için zincirlenebilir knex mock'u: her await edilen
// zincir (then/first) mockQueue'dan sıradaki sonucu çeker.
const mockQueue = [];
const mockHasEquipment = jest.fn();

jest.mock('../../../src/config/db', () => {
  const makeChain = () => {
    const chain = {};
    // DİKKAT: whereLike/orWhereLike bilinçli olarak YOK — knex MySQL dialektinde
    // 'COLLATE utf8_bin' ürettiği için utf8mb4'te patlar; servis kodu düz LIKE kullanmalı.
    const passthrough = [
      'leftJoin', 'where', 'orWhere', 'whereNull',
      'orderBy', 'limit', 'offset', 'select', 'count', 'update',
    ];
    for (const method of passthrough) {
      chain[method] = jest.fn((...args) => {
        if (typeof args[0] === 'function') args[0].call(chain, chain); // where(cb) / join(cb)
        return chain;
      });
    }
    chain.on = jest.fn(() => chain);
    chain.andOn = jest.fn(() => chain);
    chain.clone = jest.fn(() => chain);
    chain.first = jest.fn(() => Promise.resolve(mockQueue.shift()));
    chain.then = (resolve, reject) => Promise.resolve(mockQueue.shift()).then(resolve, reject);
    return chain;
  };
  const dbFn = jest.fn(() => makeChain());
  dbFn.raw = jest.fn((sql) => ({ __raw: sql }));
  return { db: dbFn };
});
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../../src/shared/asset-url', () => ({
  assetUrl: (rel) => (rel ? `https://cdn.test/${rel}` : null),
}));
jest.mock('../../../src/modules/equipment/equipment.service', () => ({
  hasProtectiveEquipment: (...a) => mockHasEquipment(...a),
  PROTECTIVE_TYPE: 'Koruyucu Ekipman',
}));

const {
  listVolunteers, getVolunteer, mapVolunteerListItem,
  computeAccuracy, previousWindow,
} = require('../../../src/modules/admin/admin.service');

describe('admin.service — listVolunteers', () => {
  beforeEach(() => {
    mockQueue.length = 0;
    mockHasEquipment.mockReset();
  });

  test('satırları panel sözleşmesine mapler (egitim/donanim bayrakları sayaçlardan)', async () => {
    mockQueue.push([{ total: 2 }]); // count
    mockQueue.push([
      {
        id: 'u1', ad: 'Ahmet', soyad: 'Yılmaz', phone: '+905321112233', eposta: 'a@b.c',
        profile_complete: 1, is_active: 1, application_status: 'pending',
        submitted_at: new Date('2026-06-01T10:00:00Z'),
        completed_trainings: '2', protective_equipment: '0',
      },
      {
        id: 'u2', ad: 'Elif', soyad: 'Demir', phone: null, eposta: null,
        profile_complete: 0, is_active: 1, application_status: null,
        submitted_at: null, completed_trainings: '0', protective_equipment: '1',
      },
    ]);

    const result = await listVolunteers({ status: 'pending', q: 'a', page: 2, pageSize: 10 });

    expect(result).toMatchObject({ total: 2, page: 2, pageSize: 10 });
    expect(result.items[0]).toEqual({
      userId: 'u1', ad: 'Ahmet', soyad: 'Yılmaz', phone: '+905321112233', eposta: 'a@b.c',
      profileComplete: true, isActive: true, applicationStatus: 'pending',
      submittedAt: '2026-06-01T10:00:00.000Z', egitim: true, donanim: false,
    });
    expect(result.items[1]).toMatchObject({
      applicationStatus: null, submittedAt: null, egitim: false, donanim: true,
    });
  });

  test('tc_kimlik liste DTO\'sunda asla yer almaz (PII)', () => {
    const item = mapVolunteerListItem({ id: 'u1', tc_kimlik: '12345678901', completed_trainings: 0 });
    expect(item).not.toHaveProperty('tcKimlik');
    expect(JSON.stringify(item)).not.toContain('12345678901');
  });
});

describe('admin.service — getVolunteer', () => {
  beforeEach(() => {
    mockQueue.length = 0;
    mockHasEquipment.mockReset();
  });

  test('kullanıcı yoksa user_not_found fırlatır', async () => {
    mockQueue.push(undefined); // users.first()
    await expect(getVolunteer('yok')).rejects.toMatchObject({ code: 'user_not_found' });
  });

  test('user + application detayını döner (PII dahil, belgeler URL)', async () => {
    mockQueue.push({
      id: 'u1', tc_kimlik: '12345678901', ad: 'Ahmet', soyad: 'Yılmaz',
      dogum_tarihi: '1990-05-01', phone: '+905321112233', eposta: 'a@b.c',
      adres: 'İstanbul', kan_grubu: 'A+', acil_ad: 'Veli', acil_soyad: 'Yılmaz',
      acil_telefon: '+905329998877', acil_yakinlik: 'kardes',
      avatar_path: 'avatars/u1.jpg', profile_complete: 1, is_active: 1,
      created_at: new Date('2026-05-01T08:00:00Z'),
    }); // users.first()
    mockQueue.push({
      id: 'app1', status: 'pending', submitted_at: new Date('2026-06-01T10:00:00Z'),
      reviewed_at: null, reviewed_by: null, reviewer_note: null,
      saglik_raporu_path: 'onboarding/saglik.pdf', sabika_kaydi_path: null,
    }); // applications.first()
    mockQueue.push({ c: 3 }); // user_trainings count.first()
    mockHasEquipment.mockResolvedValue(true);

    const result = await getVolunteer('u1');

    expect(result.user).toMatchObject({
      userId: 'u1', tcKimlik: '12345678901', dogumTarihi: '1990-05-01',
      avatarUrl: 'https://cdn.test/avatars/u1.jpg', egitim: true, donanim: true,
      acil: { ad: 'Veli', telefon: '+905329998877' },
    });
    expect(result.application).toMatchObject({
      applicationId: 'app1', status: 'pending',
      saglikRaporu: 'https://cdn.test/onboarding/saglik.pdf', sabikaKaydi: null,
    });
  });

  test('rapor yardımcıları: accuracy yüzdesi ve önceki pencere hesabı', () => {
    expect(computeAccuracy(8, 2)).toBe(80);
    expect(computeAccuracy(0, 0)).toBe(0); // karar yoksa sıfıra bölme yok
    expect(computeAccuracy(1, 2)).toBe(33);

    const from = new Date('2026-06-01T00:00:00Z');
    const to = new Date('2026-06-08T00:00:00Z');
    const prev = previousWindow(from, to);
    expect(prev.from.toISOString()).toBe('2026-05-25T00:00:00.000Z');
    expect(prev.to.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  test('başvurusu olmayan kullanıcıda application null döner', async () => {
    mockQueue.push({ id: 'u2', profile_complete: 0, is_active: 1 }); // users.first()
    mockQueue.push(undefined); // applications.first()
    mockQueue.push({ c: 0 }); // trainings count
    mockHasEquipment.mockResolvedValue(false);

    const result = await getVolunteer('u2');
    expect(result.application).toBeNull();
    expect(result.user).toMatchObject({ egitim: false, donanim: false });
  });
});
