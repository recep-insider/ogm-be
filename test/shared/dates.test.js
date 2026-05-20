'use strict';

const { toDateOnly, toIso } = require('../../src/shared/dates');

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
});
