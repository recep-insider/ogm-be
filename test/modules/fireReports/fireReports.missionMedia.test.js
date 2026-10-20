'use strict';

// The mobile mission gallery takes fire-report media only from reports linked to that
// mission; an unlinked (or other-mission) report's photos never leak into it.

const mockState = { reports: [] };

jest.mock('../../../src/config/db', () => {
  const makeChain = () => {
    let rows = mockState.reports;
    const c = {
      where: jest.fn((arg) => {
        rows = rows.filter((r) => Object.entries(arg).every(([k, v]) => r[k] === v));
        return c;
      }),
      orderBy: jest.fn(() => c),
      select: jest.fn(() => c),
      then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
    };
    return c;
  };
  return { db: Object.assign(jest.fn(() => makeChain()), { raw: jest.fn() }) };
});
jest.mock('../../../src/config/redis', () => ({ redis: { incr: jest.fn(), expire: jest.fn() } }));
jest.mock('../../../src/config/env', () => ({ geo: {}, upload: { dir: '/tmp' }, api: { baseUrl: 'https://api.test' } }));
jest.mock('../../../src/config/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/shared/push-provider', () => ({ sendPushToUser: jest.fn() }));

const service = require('../../../src/modules/fireReports/fireReports.service');

describe('mediaForMission', () => {
  it('returns media of linked reports only', async () => {
    mockState.reports = [
      { id: 'fr1', mission_id: 'm1', photo_paths: '["reports/linked.jpg"]' },
      { id: 'fr2', mission_id: null, photo_paths: '["reports/unlinked.jpg"]' },
      { id: 'fr3', mission_id: 'm2', photo_paths: '["reports/other.jpg"]' },
    ];

    expect(await service.mediaForMission('m1')).toEqual([
      { reportId: 'fr1', url: 'https://api.test/reports/linked.jpg' },
    ]);
  });
});
