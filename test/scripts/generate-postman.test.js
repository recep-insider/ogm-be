'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SPEC_PATH = path.join(ROOT, 'docs', 'openapi.json');
const OUT_PATH = path.join(ROOT, 'OGM-Gonullu.postman_collection.json');

const spec = {
  tags: [{ name: 'Admin' }],
  paths: {
    '/admin/panel-users': { get: { tags: ['Admin'], summary: 'Panel', security: [{ panelBearer: [] }] } },
    '/me': { get: { tags: ['Admin'], summary: 'Mobil', security: [{ bearerAuth: [] }] } },
    '/officer/reports': { get: { tags: ['Admin'], summary: 'Officer', security: [{ officerApiKey: [] }] } },
  },
};

function generate() {
  const realRead = fs.readFileSync;
  const realWrite = fs.writeFileSync;
  let written;
  jest.spyOn(fs, 'readFileSync').mockImplementation((p, ...rest) => (p === SPEC_PATH ? JSON.stringify(spec) : realRead(p, ...rest)));
  jest.spyOn(fs, 'writeFileSync').mockImplementation((p, data, ...rest) => {
    if (p === OUT_PATH) written = data;
    else realWrite(p, data, ...rest);
  });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.isolateModules(() => require('../../scripts/generate-postman'));
  return JSON.parse(written);
}

afterEach(() => jest.restoreAllMocks());

describe('generate-postman', () => {
  it('panelBearer uçları {{panelAccessToken}} bearer auth alır, diğerleri koleksiyon auth\'unu kullanır', () => {
    const [group] = generate().item;
    const byName = Object.fromEntries(group.item.map((i) => [i.name.split(' (')[0], i.request]));

    expect(byName.Panel.auth).toEqual({
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{panelAccessToken}}', type: 'string' }],
    });
    expect(byName.Mobil.auth).toBeUndefined();
  });

  it('officerApiKey uçları noauth ve x-api-key {{officerApiKey}} header\'ı alır', () => {
    const [group] = generate().item;
    const officer = group.item.find((i) => i.name.startsWith('Officer (')).request;

    expect(officer.auth).toEqual({ type: 'noauth' });
    expect(officer.header).toContainEqual({ key: 'x-api-key', value: '{{officerApiKey}}', type: 'text' });
  });
});
