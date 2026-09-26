'use strict';

// A readable key file: startup confirms firebase and names the project it is bound to.

jest.mock('/virtual/firebase-sa.json', () => ({ project_id: 'ogm-test' }), { virtual: true });
jest.mock(
  'firebase-admin',
  () => ({
    apps: [],
    initializeApp: jest.fn(),
    credential: { cert: jest.fn(() => 'cert'), applicationDefault: jest.fn() },
    messaging: jest.fn(() => ({ sendEachForMulticast: jest.fn() })),
  }),
  { virtual: true },
);
const mockEnv = {
  push: { provider: 'firebase' },
  firebase: { credentialsPath: '/virtual/firebase-sa.json', projectId: 'ogm-test' },
};
jest.mock('../../src/config/env', () => mockEnv);
jest.mock('../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/config/db', () => ({ db: jest.fn() }));

const admin = require('firebase-admin');
const logger = require('../../src/config/logger');
const { verifyPushProvider } = require('../../src/shared/push-provider');

describe('push-provider — startup verification with a key file', () => {
  it('initialises from the key file and names the project in the boot log', () => {
    expect(verifyPushProvider()).toEqual({ provider: 'firebase', ok: true });
    expect(admin.credential.cert).toHaveBeenCalledWith({ project_id: 'ogm-test' });
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('firebase'), { projectId: 'ogm-test' });
  });

  it('omits projectId from the boot log rather than logging an empty string', () => {
    mockEnv.firebase.projectId = '';
    logger.info.mockClear();
    verifyPushProvider();
    expect(logger.info.mock.calls[0][1].projectId).toBeUndefined();
  });
});
