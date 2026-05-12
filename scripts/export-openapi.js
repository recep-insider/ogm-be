#!/usr/bin/env node
'use strict';

/**
 * OpenAPI spec'i `docs/openapi.json` dosyasına yazar.
 *
 * Kullanım:
 *   npm run swagger:export
 *
 * Skill / slash command tarafından her geliştirme sonunda çağrılabilir.
 */
const fs = require('fs');
const path = require('path');

const { buildSpec } = require('../src/config/swagger');

const outDir = path.join(__dirname, '..', 'docs');
fs.mkdirSync(outDir, { recursive: true });

const spec = buildSpec();
const outPath = path.join(outDir, 'openapi.json');
fs.writeFileSync(outPath, JSON.stringify(spec, null, 2), 'utf8');

const pathCount = Object.keys(spec.paths || {}).length;
const operationCount = Object.values(spec.paths || {}).reduce(
  (sum, ops) =>
    sum +
    Object.keys(ops).filter((k) =>
      ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(k),
    ).length,
  0,
);

console.log(`✓ OpenAPI spec yazıldı: ${path.relative(process.cwd(), outPath)}`);
console.log(`  paths: ${pathCount}, operations: ${operationCount}`);
