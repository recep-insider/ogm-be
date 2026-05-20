'use strict';

/**
 * docs/openapi.json'dan Postman v2.1 collection üretir.
 * Koleksiyon seviyesi Bearer auth ({{accessToken}}) + auth flow için token yakalama script'i ekler.
 * Endpoint'lerle senkron kalması için `npm run swagger:export` sonrası çalıştırın.
 */
const fs = require('fs');
const path = require('path');

const SPEC_PATH = path.join(__dirname, '..', 'docs', 'openapi.json');
const OUT_PATH = path.join(__dirname, '..', 'OGM-Gonullu.postman_collection.json');

const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));

function resolveRef(ref) {
  const parts = ref.replace(/^#\//, '').split('/');
  let node = spec;
  for (const p of parts) node = node[p];
  return node;
}

function exampleFromSchema(schema, depth = 0) {
  if (!schema || depth > 6) return null;
  if (schema.$ref) return exampleFromSchema(resolveRef(schema.$ref), depth + 1);
  if (schema.allOf) {
    return schema.allOf.reduce((acc, s) => Object.assign(acc, exampleFromSchema(s, depth + 1) || {}), {});
  }
  if (schema.oneOf) return exampleFromSchema(schema.oneOf[0], depth + 1);
  if (schema.example !== undefined) return schema.example;
  if (schema.enum) return schema.enum[0];

  switch (schema.type) {
    case 'object': {
      const out = {};
      for (const [k, v] of Object.entries(schema.properties || {})) {
        out[k] = exampleFromSchema(v, depth + 1);
      }
      return out;
    }
    case 'array':
      return [exampleFromSchema(schema.items, depth + 1)].filter((x) => x !== null);
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return true;
    case 'string':
      if (schema.format === 'date') return '2026-01-01';
      if (schema.format === 'date-time') return '2026-01-01T00:00:00Z';
      if (schema.format === 'uri') return 'https://example.com/x.jpg';
      return '';
    default:
      return null;
  }
}

function toPathSegments(p) {
  return p.split('/').filter(Boolean).map((seg) => seg.replace(/^\{(.+)\}$/, ':$1'));
}

function buildItem(routePath, method, op) {
  const segments = ['v1', ...toPathSegments(routePath)];
  const pathVars = segments.filter((s) => s.startsWith(':')).map((s) => ({
    key: s.slice(1),
    value: '',
  }));

  const url = {
    raw: `{{baseUrl}}/${segments.join('/')}`,
    host: ['{{baseUrl}}'],
    path: segments,
  };
  if (pathVars.length) url.variable = pathVars;

  const headers = [];
  const request = { method: method.toUpperCase(), header: headers, url };
  if (op.description) request.description = op.description;

  // Güvenlik: apiKey'li uçlar header + noauth; bearer ise koleksiyon auth'u kullan.
  const sec = (op.security || []).flatMap((s) => Object.keys(s));
  if (sec.includes('adminApiKey') || sec.includes('officerApiKey')) {
    request.auth = { type: 'noauth' };
    headers.push({
      key: 'x-api-key',
      value: sec.includes('officerApiKey') ? '{{officerApiKey}}' : '{{adminApiKey}}',
      type: 'text',
    });
  } else if (op.security && op.security.length === 0 && !routePath.includes('/users/')) {
    request.auth = { type: 'noauth' };
  }

  // Request body
  const body = op.requestBody && op.requestBody.content;
  if (body) {
    if (body['application/json']) {
      const ex = exampleFromSchema(body['application/json'].schema) || {};
      headers.push({ key: 'Content-Type', value: 'application/json', type: 'text' });
      request.body = { mode: 'raw', raw: JSON.stringify(ex, null, 2), options: { raw: { language: 'json' } } };
    } else if (body['multipart/form-data']) {
      const props = (body['multipart/form-data'].schema || {}).properties || {};
      request.body = {
        mode: 'formdata',
        formdata: Object.entries(props).map(([k, v]) => {
          if (v.format === 'binary' || (v.type === 'array' && v.items && v.items.format === 'binary')) {
            return { key: k, type: 'file', src: [] };
          }
          return { key: k, type: 'text', value: k === 'data' ? '{}' : '' };
        }),
      };
    }
  }

  const item = {
    name: `${op.summary || method.toUpperCase()} (${method.toUpperCase()} /${segments.join('/')})`,
    request,
  };

  // Auth flow: verify-otp response'undan token'ları yakala.
  if (routePath === '/auth/phone/verify-otp') {
    item.event = [{
      listen: 'test',
      script: {
        type: 'text/javascript',
        exec: [
          'const j = pm.response.json();',
          'if (j.accessToken) pm.collectionVariables.set("accessToken", j.accessToken);',
          'if (j.refreshToken) pm.collectionVariables.set("refreshToken", j.refreshToken);',
          'if (j.registrationToken) pm.collectionVariables.set("registrationToken", j.registrationToken);',
        ],
      },
    }];
  }
  if (routePath === '/auth/phone/send-otp') {
    item.event = [{
      listen: 'test',
      script: {
        type: 'text/javascript',
        exec: [
          'const j = pm.response.json();',
          'if (j.sessionId) pm.collectionVariables.set("sessionId", j.sessionId);',
        ],
      },
    }];
  }
  return item;
}

// Tag bazlı gruplama
const groups = new Map();
for (const tag of spec.tags || []) groups.set(tag.name, []);

for (const [routePath, methods] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    const tag = (op.tags && op.tags[0]) || 'Other';
    if (!groups.has(tag)) groups.set(tag, []);
    groups.get(tag).push(buildItem(routePath, method, op));
  }
}

const collection = {
  info: {
    name: 'OGM Gönüllü Yönetim Sistemi — API',
    _postman_id: 'a1b2c3d4-0000-4000-8000-ogmgonullu02',
    description:
      'BACKEND_API_CONTRACT.md kontratına uygun, docs/openapi.json\'dan üretilmiş collection.\n\n'
      + '1. `baseUrl` (default http://localhost:3000) ve gerekiyorsa `adminApiKey`/`officerApiKey` ayarla.\n'
      + '2. Auth - Phone > send-otp → sessionId otomatik kaydedilir.\n'
      + '3. verify-otp → accessToken/refreshToken otomatik kaydedilir.\n'
      + '4. Korumalı uçlar koleksiyon seviyesinde Bearer {{accessToken}} kullanır.\n\n'
      + 'Dummy OTP: phone=+905555555555, code=123456 (OTP_DUMMY_PHONES bu numarayı içermeli).',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }] },
  variable: [
    { key: 'baseUrl', value: 'https://recepbiyikli.com', type: 'string' },
    { key: 'phone', value: '+905555555555', type: 'string' },
    { key: 'otpCode', value: '123456', type: 'string' },
    { key: 'sessionId', value: '', type: 'string' },
    { key: 'accessToken', value: '', type: 'string' },
    { key: 'refreshToken', value: '', type: 'string' },
    { key: 'registrationToken', value: '', type: 'string' },
    { key: 'adminApiKey', value: '', type: 'string' },
    { key: 'officerApiKey', value: '', type: 'string' },
  ],
  item: [],
};

for (const [tag, items] of groups) {
  if (!items.length) continue;
  collection.item.push({ name: tag, item: items });
}

fs.writeFileSync(OUT_PATH, `${JSON.stringify(collection, null, 2)}\n`, 'utf8');
const opCount = collection.item.reduce((n, g) => n + g.item.length, 0);
console.log(`✓ Postman collection yazıldı: ${path.relative(path.join(__dirname, '..'), OUT_PATH)}`);
console.log(`  gruplar: ${collection.item.length}, istekler: ${opCount}`);
