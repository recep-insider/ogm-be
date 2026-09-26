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
jest.mock('../../src/config/db', () => ({
  db: jest.fn(() => {
    const c = {
      where: jest.fn(() => c),
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
});
