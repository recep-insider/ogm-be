'use strict';

// With FIREBASE_CREDENTIALS_PATH empty, firebase-admin would silently fall back to
// application default credentials (a GCE metadata server this VPS does not have) and
// every send would fail later. Startup must refuse that configuration loudly instead.

const mockInitializeApp = jest.fn();
jest.mock(
  'firebase-admin',
  () => ({
    apps: [],
    initializeApp: mockInitializeApp,
    credential: { cert: jest.fn(), applicationDefault: jest.fn(() => 'adc') },
    messaging: jest.fn(() => ({ sendEachForMulticast: jest.fn() })),
  }),
  { virtual: true },
);
jest.mock('../../src/config/env', () => ({
  push: { provider: 'firebase' },
  firebase: { credentialsPath: '', projectId: '' },
}));
jest.mock('../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/config/db', () => ({ db: jest.fn() }));

const logger = require('../../src/config/logger');
const { verifyPushProvider } = require('../../src/shared/push-provider');

describe('push-provider — startup verification without a key file', () => {
  it('reports firebase as not ok instead of falling back to default credentials', () => {
    expect(verifyPushProvider()).toEqual({ provider: 'firebase', ok: false });
    expect(mockInitializeApp).not.toHaveBeenCalled();
  });

  it('names the missing setting in a loud error', () => {
    logger.error.mockClear();
    verifyPushProvider();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('FIREBASE_CREDENTIALS_PATH boş'));
  });
});
