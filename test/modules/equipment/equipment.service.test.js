'use strict';

const { computeStatus, mapEquipment } = require('../../../src/modules/equipment/equipment.service');

describe('equipment computeStatus', () => {
  const DAY = 86400 * 1000;

  it('expires_at null → active', () => {
    expect(computeStatus(null)).toBe('active');
  });

  it('geçmiş tarih → expired', () => {
    expect(computeStatus(new Date(Date.now() - 10 * DAY))).toBe('expired');
  });

  it('30 gün içinde → expiring_soon', () => {
    expect(computeStatus(new Date(Date.now() + 10 * DAY))).toBe('expiring_soon');
  });

  it('uzak gelecek → active', () => {
    expect(computeStatus(new Date(Date.now() + 200 * DAY))).toBe('active');
  });

  it('mapEquipment alanları kontrata uygun', () => {
    const row = {
      id: 'eq_1',
      name: 'Kask',
      type: 'Koruyucu Ekipman',
      assigned_at: '2025-09-25',
      expires_at: null,
      icon_name: 'helmet',
    };
    expect(mapEquipment(row)).toEqual({
      id: 'eq_1',
      name: 'Kask',
      type: 'Koruyucu Ekipman',
      assignedAt: '2025-09-25',
      expiresAt: null,
      status: 'active',
      iconName: 'helmet',
    });
  });
});
