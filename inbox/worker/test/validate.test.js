import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { validate } from '../lib/validate.js';
import { NRS_SCHEMA } from '../lib/schema.js';
import { makeSignedRecord } from './fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..', '..', '..');
const require = createRequire(import.meta.url);

test('vendored schema is deep-equal to the canonical spec copy (no drift)', () => {
  const canonical = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'spec', 'schema', 'nrs-0.1.schema.json'), 'utf8'));
  assert.deepStrictEqual(NRS_SCHEMA, canonical);
});

test('vendored validator behaves identically to the CLI validator', () => {
  const cli = require(path.join(repoRoot, 'cli', 'lib', 'validate.js')).validate;
  const { record } = makeSignedRecord();
  const cases = [
    [NRS_SCHEMA, record],
    [NRS_SCHEMA, { ...record, vibes: 'immaculate' }],
    [NRS_SCHEMA, (() => { const r = JSON.parse(JSON.stringify(record)); delete r.transferability; return r; })()],
    [NRS_SCHEMA, (() => { const r = JSON.parse(JSON.stringify(record)); r.failure.mode = 'skill_issue'; return r; })()],
    [NRS_SCHEMA, (() => { const r = JSON.parse(JSON.stringify(record)); r.problem.statement = 'short'; return r; })()],
    [{ type: 'string', pattern: '^x' }, 'yz'],
    [{ type: 'string', format: 'date-time' }, 'not-a-date'],
  ];
  for (const [schema, value] of cases) {
    assert.deepStrictEqual(validate(schema, value), cli(schema, value));
  }
});

test('a well-formed record passes; tampering and unknown fields fail', () => {
  const { record } = makeSignedRecord();
  assert.strictEqual(validate(NRS_SCHEMA, record).length, 0);

  const noTransfer = JSON.parse(JSON.stringify(record));
  delete noTransfer.transferability;
  assert.ok(validate(NRS_SCHEMA, noTransfer).some((e) => e.includes('transferability')));

  const extra = JSON.parse(JSON.stringify(record));
  extra.vibes = 'immaculate';
  assert.ok(validate(NRS_SCHEMA, extra).some((e) => e.includes('additional property')));
});
