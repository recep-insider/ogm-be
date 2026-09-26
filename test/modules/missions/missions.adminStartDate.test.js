'use strict';

// The panel edits a mission's start day from mapAdminMission's startDate. When the
// row has no start_date the day is derived from started_at in Istanbul time, so a
// mission that started shortly after local midnight is not written back a day early.

const { mapAdminMission } = jest.requireActual('../../../src/modules/missions/missions.service');

const baseRow = {
  id: 'm1',
  title: 'Orman Yangını',
  short_location: 'Manavgat',
  il: 'Antalya',
  status: 'active',
  is_active: 1,
};

describe('mapAdminMission startDate', () => {
  it('returns start_date unchanged when it is set', () => {
    const mapped = mapAdminMission({
      ...baseRow,
      start_date: '2026-07-10',
      started_at: new Date('2026-07-13T22:30:00.000Z'),
    });

    expect(mapped.startDate).toBe('2026-07-10');
  });

  it('returns the Istanbul day of started_at when start_date is empty', () => {
    // 22:30 UTC on the 13th is 01:30 on the 14th in Istanbul (UTC+3).
    const mapped = mapAdminMission({
      ...baseRow,
      start_date: null,
      started_at: new Date('2026-07-13T22:30:00.000Z'),
    });

    expect(mapped.startDate).toBe('2026-07-14');
  });

  it('returns null when neither start_date nor started_at is set', () => {
    const mapped = mapAdminMission({ ...baseRow, start_date: null, started_at: null });

    expect(mapped.startDate).toBeNull();
  });
});
