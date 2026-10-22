'use strict';

// Toplanma noktası görevlisi (ad/telefon) — tekrarlanan upsert'te gönderilmeyen görevli
// alanı korunur; null veya '' açıkça temizler.

const mockState = { mission: null, point: null, inserts: [], updates: [] };

jest.mock('../../../src/config/db', () => {
  const makeChain = (table) => {
    const c = {
      where: jest.fn(() => c),
      first: jest.fn(async () => {
        if (table === 'missions') return mockState.mission;
        if (table === 'assembly_points') return mockState.point;
        return undefined;
      }),
      insert: jest.fn(async (row) => {
        mockState.inserts.push(row);
        return [1];
      }),
      update: jest.fn(async (row) => {
        mockState.updates.push(row);
        return 1;
      }),
    };
    return c;
  };
  const db = Object.assign(jest.fn((table) => makeChain(table)), { raw: jest.fn() });
  return { db };
});
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/shared/push-provider', () => ({ sendPushToUser: jest.fn() }));
jest.mock('../../../src/shared/sms-provider', () => ({ sendSms: jest.fn() }));

const service = require('../../../src/modules/missions/assemblyPoints.service');

const EXISTING = {
  id: 'ap1',
  mission_id: 'm1',
  name: 'Okul bahçesi',
  address: null,
  lat: 36.86,
  lng: 28.28,
  is_open: 1,
  officer_name: 'Mehmet Kaya',
  officer_phone: '+905321112233',
};
const SAME_PLACE = { name: 'Okul bahçesi', coordinates: { lat: 36.86, lng: 28.28 } };

const reset = () => {
  mockState.mission = { id: 'm1', status: 'active' };
  mockState.point = { ...EXISTING };
  mockState.inserts = [];
  mockState.updates = [];
  jest.clearAllMocks();
};

describe('assemblyPoints.upsert — görevli alanları', () => {
  beforeEach(reset);

  it('görevli alanları gönderilmezse update satırına girmez (mevcut değer korunur)', async () => {
    await service.upsert('m1', SAME_PLACE, {});

    expect(mockState.updates[0]).not.toHaveProperty('officer_name');
    expect(mockState.updates[0]).not.toHaveProperty('officer_phone');
  });

  it.each([[null], ['']])('%p gönderilirse görevli alanı temizlenir', async (value) => {
    await service.upsert('m1', { ...SAME_PLACE, officerName: value, officerPhone: value }, {});

    expect(mockState.updates[0]).toMatchObject({ officer_name: null, officer_phone: null });
  });

  it('yeni değer gönderilirse yazılır', async () => {
    await service.upsert('m1', { ...SAME_PLACE, officerPhone: '+90 555 000 00 00' }, {});

    expect(mockState.updates[0]).toMatchObject({ officer_phone: '+90 555 000 00 00' });
    expect(mockState.updates[0]).not.toHaveProperty('officer_name');
  });

  it('ilk oluşturmada verilmeyen görevli alanları null yazılır', async () => {
    mockState.point = null;

    await service.upsert('m1', { ...SAME_PLACE, officerName: 'Ayşe Demir' }, {});

    expect(mockState.inserts[0]).toMatchObject({ officer_name: 'Ayşe Demir', officer_phone: null });
  });
});

describe('assemblyPoints.upsert — adres ve açık/kapalı durumu', () => {
  beforeEach(reset);

  it('adres gönderilmezse update satırına girmez (mevcut adres korunur)', async () => {
    mockState.point = { ...EXISTING, address: 'Atatürk Cad. No:1' };

    await service.upsert('m1', SAME_PLACE, {});

    expect(mockState.updates[0]).not.toHaveProperty('address');
  });

  it('isOpen gönderilmezse kapalı nokta yeniden açılmaz', async () => {
    mockState.point = { ...EXISTING, is_open: 0 };

    await service.upsert('m1', SAME_PLACE, {});

    expect(mockState.updates[0]).not.toHaveProperty('is_open');
  });

  it.each([[null], ['']])('adres %p gönderilirse temizlenir', async (value) => {
    await service.upsert('m1', { ...SAME_PLACE, address: value }, {});

    expect(mockState.updates[0]).toMatchObject({ address: null });
  });

  it('gönderilen adres ve isOpen yazılır', async () => {
    await service.upsert('m1', { ...SAME_PLACE, address: 'Yeni adres', isOpen: false }, {});

    expect(mockState.updates[0]).toMatchObject({ address: 'Yeni adres', is_open: false });
  });

  it('ilk oluşturmada adres null, nokta açık yazılır', async () => {
    mockState.point = null;

    await service.upsert('m1', SAME_PLACE, {});

    expect(mockState.inserts[0]).toMatchObject({ address: null, is_open: true });
  });
});

describe('assemblyPoints.upsert — denetim kaydı', () => {
  beforeEach(reset);

  it('zaman çizelgesi için noktanın yeni adı kayda yazılır', async () => {
    const { writeAudit } = require('../../../src/shared/audit');

    await service.upsert('m1', { ...SAME_PLACE, name: 'Stadyum otoparkı' }, { userId: 'p1' });

    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'assembly_point.update',
        entityId: 'm1',
        payload: { name: 'Stadyum otoparkı', locationChanged: false, notified: null },
      }),
    );
  });
});

describe('assemblyPoints.mapPoint — görevli alanları', () => {
  it('görevli adı ve telefonunu döner', () => {
    expect(service.mapPoint(EXISTING)).toMatchObject({
      officerName: 'Mehmet Kaya',
      officerPhone: '+905321112233',
    });
  });

  it('boş değerler null döner', () => {
    expect(service.mapPoint({ ...EXISTING, officer_name: '', officer_phone: null })).toMatchObject({
      officerName: null,
      officerPhone: null,
    });
  });
});
