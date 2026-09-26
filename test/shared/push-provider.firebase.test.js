'use strict';

// With PUSH_PROVIDER=firebase, deliver() must hand FCM exactly the multicast message
// buildMulticast produces and report FCM's own success/failure counts.

const mockMessaging = { sendEachForMulticast: jest.fn() };

jest.mock(
  'firebase-admin',
  () => ({
    apps: [],
    initializeApp: jest.fn(),
    credential: { cert: jest.fn(), applicationDefault: jest.fn(() => 'adc') },
    messaging: jest.fn(() => mockMessaging),
  }),
  { virtual: true },
);
jest.mock('../../src/config/env', () => ({
  push: { provider: 'Firebase' },
  firebase: { credentialsPath: '', projectId: 'ogm-test' },
}));
jest.mock('../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
const mockDeleted = [];
jest.mock('../../src/config/db', () => ({
  db: jest.fn(() => {
    const c = {
      where: jest.fn(() => c),
      whereIn: jest.fn((_col, values) => {
        c.pending = values;
        return c;
      }),
      del: jest.fn(async () => {
        mockDeleted.push(...c.pending);
        return c.pending.length;
      }),
      first: jest.fn(async () => undefined),
      pluck: jest.fn(async () => ['tok-1', 'tok-2']),
    };
    return c;
  }),
}));

const admin = require('firebase-admin');
const { sendPushToUser, buildMulticast } = require('../../src/shared/push-provider');

describe('push-provider — firebase delivery', () => {
  beforeEach(() => {
    mockMessaging.sendEachForMulticast.mockReset();
  });

  it('sends the buildMulticast output to sendEachForMulticast', async () => {
    mockMessaging.sendEachForMulticast.mockResolvedValue({ successCount: 2, failureCount: 0 });
    const payload = {
      topic: 'acil',
      channelId: 'fire-report-confirmed',
      title: 'Tahliye',
      body: 'Bölgeyi terk edin',
      data: { type: 'evacuation', missionId: 'm1', extra: null },
    };

    await sendPushToUser('u1', payload);

    expect(mockMessaging.sendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(mockMessaging.sendEachForMulticast).toHaveBeenCalledWith(
      buildMulticast(['tok-1', 'tok-2'], payload),
    );
  });

  it('reports the success and failure counts FCM returns', async () => {
    mockMessaging.sendEachForMulticast.mockResolvedValue({ successCount: 1, failureCount: 1 });

    const result = await sendPushToUser('u1', { topic: 'acil', title: 'T', body: 'B' });

    expect(result).toEqual({ sent: 1, failed: 1 });
  });

  it('initialises firebase-admin with application default credentials when no key file is set', async () => {
    mockMessaging.sendEachForMulticast.mockResolvedValue({ successCount: 1, failureCount: 0 });

    await sendPushToUser('u1', { topic: 'acil', title: 'T', body: 'B' });

    expect(admin.initializeApp).toHaveBeenCalledWith({ credential: 'adc', projectId: 'ogm-test' });
  });

  it('deletes the device rows FCM reports as unregistered', async () => {
    mockDeleted.length = 0;
    mockMessaging.sendEachForMulticast.mockResolvedValue({
      successCount: 1,
      failureCount: 1,
      responses: [
        { success: true },
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      ],
    });

    await sendPushToUser('u1', { topic: 'acil', title: 'T', body: 'B' });

    expect(mockDeleted).toEqual(['tok-2']);
  });

  it('deletes dead tokens from the devices table by the fcm_token column', async () => {
    mockMessaging.sendEachForMulticast.mockResolvedValue({
      successCount: 1,
      failureCount: 1,
      responses: [
        { success: true },
        { success: false, error: { code: 'messaging/invalid-registration-token' } },
      ],
    });
    const { db } = require('../../src/config/db');
    db.mockClear();

    await sendPushToUser('u1', { topic: 'acil', title: 'T', body: 'B' });

    const deleteBuilder = db.mock.results.find((r) => r.value.del.mock.calls.length > 0);
    const deleteCallIndex = db.mock.results.indexOf(deleteBuilder);
    expect(db.mock.calls[deleteCallIndex]).toEqual(['devices']);
    expect(deleteBuilder.value.whereIn).toHaveBeenCalledWith('fcm_token', ['tok-2']);
  });

  it('still reports the FCM counts after a dead-token cleanup', async () => {
    mockMessaging.sendEachForMulticast.mockResolvedValue({
      successCount: 1,
      failureCount: 1,
      responses: [
        { success: true },
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      ],
    });

    const result = await sendPushToUser('u1', { topic: 'acil', title: 'T', body: 'B' });

    expect(result).toEqual({ sent: 1, failed: 1 });
  });

  it('runs no delete when every failure is transient', async () => {
    mockMessaging.sendEachForMulticast.mockResolvedValue({
      successCount: 0,
      failureCount: 2,
      responses: [
        { success: false, error: { code: 'messaging/internal-error' } },
        { success: false, error: { code: 'messaging/server-unavailable' } },
      ],
    });
    const { db } = require('../../src/config/db');
    db.mockClear();

    await sendPushToUser('u1', { topic: 'acil', title: 'T', body: 'B' });

    const deleted = db.mock.results.filter((r) => r.value.del.mock.calls.length > 0);
    expect(deleted).toHaveLength(0);
  });
});
