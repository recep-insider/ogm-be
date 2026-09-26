'use strict';

// The report ↔ mission link reaches mobile: mapReport carries missionId, and the reporter
// learns about the confirmation (status change or link) through a push carrying it.

const mockState = { reports: [], mission: null, updates: [] };

jest.mock('../../../src/config/db', () => {
  const makeChain = (table) => {
    let filterId = null;
    const c = {
      where: jest.fn((arg) => {
        if (arg && typeof arg === 'object' && arg.id) filterId = arg.id;
        return c;
      }),
      whereIn: jest.fn(() => c),
      whereRaw: jest.fn(() => c),
      orWhere: jest.fn(() => c),
      select: jest.fn(() => c),
      first: jest.fn(async () => {
        if (table === 'missions') return mockState.mission;
        return mockState.reports.find((r) => r.id === filterId);
      }),
      update: jest.fn(async (row) => {
        mockState.updates.push({ table, filterId, row });
        return 1;
      }),
      then: (resolve, reject) => Promise.resolve(mockState.reports).then(resolve, reject),
    };
    return c;
  };
  return { db: Object.assign(jest.fn((t) => makeChain(t)), { raw: jest.fn() }) };
});
jest.mock('../../../src/config/redis', () => ({ redis: { incr: jest.fn(), expire: jest.fn() } }));
jest.mock('../../../src/config/env', () => ({ geo: {}, upload: { dir: '/tmp' }, api: { baseUrl: 'https://api.test' } }));
jest.mock('../../../src/config/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/shared/push-provider', () => ({ sendPushToUser: jest.fn() }));

const { sendPushToUser } = require('../../../src/shared/push-provider');
const service = require('../../../src/modules/fireReports/fireReports.service');

const report = (over = {}) => ({
  id: 'fr1',
  user_id: 'u1',
  status: 'reviewing',
  mission_id: null,
  latitude: '36.85',
  longitude: '28.27',
  created_at: new Date('2026-06-09T14:23:00Z'),
  ...over,
});

beforeEach(() => {
  mockState.reports = [report()];
  mockState.mission = { id: 'm1', status: 'active' };
  mockState.updates = [];
  jest.clearAllMocks();
});

describe('mapReport — missionId', () => {
  it('is null for an unlinked report', () => {
    expect(service.mapReport(report()).missionId).toBeNull();
  });

  it('carries the linked mission id', () => {
    expect(service.mapReport(report({ mission_id: 'm1' })).missionId).toBe('m1');
  });
});

describe('linkToMission — reporter push', () => {
  it('sends a fire_report_status push with status confirmed and the mission id', async () => {
    await service.linkToMission('m1', ['fr1'], {});

    expect(sendPushToUser).toHaveBeenCalledWith('u1', expect.objectContaining({
      topic: 'taskCalls',
      // The app shows report results on their own Android channel, not "Görev Çağrıları".
      channelId: 'fire-report-confirmed',
      data: { type: 'fire_report_status', reportId: 'fr1', status: 'confirmed', missionId: 'm1' },
    }));
  });

  it('skips guest reports without a user', async () => {
    mockState.reports = [report({ user_id: null })];
    await service.linkToMission('m1', ['fr1'], {});
    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it('does not re-notify a report already confirmed on the same mission', async () => {
    mockState.reports = [report({ mission_id: 'm1', status: 'confirmed' })];
    await service.linkToMission('m1', ['fr1'], {});
    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it('notifies again when a confirmed report is re-linked to a different mission', async () => {
    mockState.reports = [report({ mission_id: 'm0', status: 'confirmed' })];
    await service.linkToMission('m1', ['fr1'], {});
    expect(sendPushToUser).toHaveBeenCalledWith('u1', expect.objectContaining({
      data: expect.objectContaining({ missionId: 'm1' }),
    }));
  });

  it('notifies when an unconfirmed report is already linked to the same mission', async () => {
    mockState.reports = [report({ mission_id: 'm1', status: 'reviewing' })];
    await service.linkToMission('m1', ['fr1'], {});
    expect(sendPushToUser).toHaveBeenCalledTimes(1);
  });
});

describe('adminSetStatus — push data', () => {
  it('includes missionId when the report is linked', async () => {
    mockState.reports = [report({ mission_id: 'm1' })];
    await service.adminSetStatus('fr1', { status: 'confirmed' }, {});
    expect(sendPushToUser.mock.calls[0][1].data).toEqual({
      type: 'fire_report_status',
      reportId: 'fr1',
      status: 'confirmed',
      missionId: 'm1',
    });
  });

  it('omits missionId entirely when the report is unlinked', async () => {
    await service.adminSetStatus('fr1', { status: 'rejected' }, {});
    expect(sendPushToUser.mock.calls[0][1].data).not.toHaveProperty('missionId');
  });
});
