'use strict';

jest.mock('../../src/config/db', () => ({ db: jest.fn() }));
jest.mock('../../src/config/logger', () => ({ warn: jest.fn() }));

const { db } = require('../../src/config/db');
const { writeAudit } = require('../../src/shared/audit');

describe('writeAudit — bağlantı parametresi', () => {
  beforeEach(() => jest.clearAllMocks());

  it('verilen bağlantıya yazar, modül db kullanılmaz', async () => {
    const insert = jest.fn(async () => [1]);
    const fakeConn = jest.fn(() => ({ insert }));

    await writeAudit({ action: 'x' }, fakeConn);

    expect(fakeConn).toHaveBeenCalledWith('audit_log');
    expect(insert).toHaveBeenCalledWith({
      user_id: null,
      action: 'x',
      entity: null,
      entity_id: null,
      ip: null,
      user_agent: null,
      payload: null,
    });
    expect(db).not.toHaveBeenCalled();
  });
});
