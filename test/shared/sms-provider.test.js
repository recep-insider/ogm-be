'use strict';

jest.mock('axios');

describe('sendOtp — dummy phone bypass', () => {
  let axios;
  let env;
  let sendOtp;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    axios = require('axios');
    env = require('../../src/config/env');
    ({ sendOtp } = require('../../src/shared/sms-provider'));
  });

  test('dummy phone için provider çağrılmaz, dummy sonuç döner', async () => {
    env.sms.dummyPhones = ['+905555555555'];

    const res = await sendOtp('+905555555555', '123456');

    expect(res.dummy).toBe(true);
    expect(res.providerMessageId).toMatch(/^dummy-/);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('dummy listede olmayan numara mock provider yolundan geçer', async () => {
    env.sms.dummyPhones = [];
    env.sms.provider = 'mock';

    const res = await sendOtp('+905321112233', '123456');

    expect(res.dummy).toBeUndefined();
    expect(res.providerMessageId).toMatch(/^mock-/);
  });
});
