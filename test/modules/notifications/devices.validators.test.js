'use strict';

const { registerSchema } = require('../../../src/modules/notifications/notifications.validators');

describe('notifications — device registration schema', () => {
  it('accepts a real FCM token', () => {
    const { error } = registerSchema.validate({ token: 'dXk3:APA91bH-real-fcm-token', platform: 'ios' });
    expect(error).toBeUndefined();
  });

  it('rejects the stub- placeholder tokens older builds synthesised', () => {
    const { error } = registerSchema.validate({ token: 'stub-ios-1790000000000-abc', platform: 'ios' });
    expect(error).toBeDefined();
    expect(error.details[0].message).toBe("Geçersiz cihaz token'ı");
  });
});
