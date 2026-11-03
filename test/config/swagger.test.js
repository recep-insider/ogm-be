'use strict';

// Ayrıştırılamayan bir @openapi bloğu Swagger'dan sessizce düşer: tırnaksız açıklamadaki "x: y" YAML'de iç içe
// eşleme sayılıyordu ve POST /sos, POST /fire-reports ile operatör medya yüklemesi belgede görünmüyordu.

const { buildSpec } = require('../../src/config/swagger');

describe('Swagger belgesi', () => {
  it.each([
    ['/sos', 'post'],
    ['/fire-reports', 'post'],
    ['/admin/missions/{id}/media', 'post'],
  ])('%s %s belgede yer alır', (path, method) => {
    expect(buildSpec().paths[path]?.[method]).toBeDefined();
  });
});
