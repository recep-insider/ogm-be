'use strict';

const { toDateOnly, toLocalDateOnly, toIso } = require('../../src/shared/dates');

describe('dates', () => {
  it('toDateOnly Date → YYYY-MM-DD', () => {
    expect(toDateOnly(new Date('2026-05-20T14:32:00Z'))).toBe('2026-05-20');
  });
  it('toDateOnly string kırpar', () => {
    expect(toDateOnly('1992-03-14T00:00:00.000Z')).toBe('1992-03-14');
    expect(toDateOnly('1992-03-14')).toBe('1992-03-14');
  });
  it('toDateOnly null → null', () => {
    expect(toDateOnly(null)).toBeNull();
  });
  it('toIso Date → ISO', () => {
    expect(toIso(new Date('2026-05-20T11:00:00Z'))).toBe('2026-05-20T11:00:00.000Z');
  });
  it('toIso null → null', () => {
    expect(toIso(null)).toBeNull();
  });
  it('toLocalDateOnly takes the Istanbul calendar day, not the UTC day', () => {
    // 2026-07-14 01:30 in Turkey (+03:00) is still 2026-07-13 in UTC.
    expect(toLocalDateOnly(new Date('2026-07-13T22:30:00Z'))).toBe('2026-07-14');
    expect(toLocalDateOnly('2026-07-13T22:30:00.000Z')).toBe('2026-07-14');
    expect(toLocalDateOnly(new Date('2026-07-14T12:00:00Z'))).toBe('2026-07-14');
  });
  it('toLocalDateOnly null → null, unparsable string falls back to toDateOnly', () => {
    expect(toLocalDateOnly(null)).toBeNull();
    expect(toLocalDateOnly('not-a-date')).toBe('not-a-date');
  });
});
