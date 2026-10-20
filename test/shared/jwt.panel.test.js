'use strict';

const jsonwebtoken = require('jsonwebtoken');
const {
  signAccessToken,
  verifyAccessToken,
  verifyRegistrationToken,
  signPanelAccessToken,
  verifyPanelAccessToken,
  panelAccessTokenSeconds,
} = require('../../src/shared/jwt');

describe('panel access token', () => {
  it('sub, role, typ, aud, iss ve 15 dk ömür taşır (SIM-1072)', () => {
    const token = signPanelAccessToken({ sub: 'p1', role: 'super_admin' });
    const claims = jsonwebtoken.decode(token);

    expect(claims).toMatchObject({
      sub: 'p1',
      role: 'super_admin',
      typ: 'panel_access',
      aud: 'ogm-panel',
      iss: 'ogm-gonullu-api',
    });
    expect(claims.exp - claims.iat).toBe(900);
    expect(panelAccessTokenSeconds()).toBe(900);
    expect(verifyPanelAccessToken(token).sub).toBe('p1');
  });

  it('mobil verifyAccessToken / verifyRegistrationToken panel token\'ını reddeder', () => {
    const token = signPanelAccessToken({ sub: 'p1', role: 'admin' });
    expect(() => verifyAccessToken(token)).toThrow();
    expect(() => verifyRegistrationToken(token)).toThrow();
  });

  it('verifyPanelAccessToken mobil access token\'ını reddeder (role claim\'i olsa da)', () => {
    expect(() => verifyPanelAccessToken(signAccessToken({ sub: 'u1', role: 'admin' }))).toThrow();
  });

  it('rolü tanımsız panel token\'ı imzalansa da doğrulanmaz', () => {
    expect(() => verifyPanelAccessToken(signPanelAccessToken({ sub: 'p1' }))).toThrow();
  });
});
