#!/usr/bin/env node
// benchmark/add-tenant.js
// Programmatically add the 'benchmark' tenant to qmd-bridge config.
// Usage: node benchmark/add-tenant.js

import { addTenant, getTenant } from '../src/services/tenant.js';

const LABEL = 'benchmark';
const DOCS_PATH = '/tmp/qmd-benchmark/docs';

const existing = getTenant(LABEL);
if (existing) {
  console.log(`Tenant '${LABEL}' already exists.`);
  console.log(`Token: ${existing.token}`);
  process.exit(0);
}

const result = addTenant({
  label: LABEL,
  displayName: 'Benchmark Collection',
  path: DOCS_PATH,
  collection: LABEL,
});

if (result.success) {
  console.log(`✓ Tenant '${LABEL}' added.`);
  console.log(`Token: ${result.token}`);
} else {
  console.error(`✗ Failed: ${result.error}`);
  process.exit(1);
}
