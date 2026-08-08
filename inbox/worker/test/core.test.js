import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { canonicalize, canonicalBody, computeId, verifyRecord, shardPath } from '../lib/core.js';
import { makeSignedRecord } from './fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..', '..', '..');
const require = createRequire(import.meta.url);

test('canonicalize matches the CLI implementation byte-for-byte', () => {
  const cliCore = require(path.join(repoRoot, 'cli', 'lib', 'core.js'));
  const samples = [
    { b: 1, a: { d: 2, c: 3 } },
    [3, 1, { z: true, a: null }],
    { s: 'a"b\n' },
    1000000,
  ];
  for (const s of samples) {
    assert.strictEqual(canonicalize(s), cliCore.canonicalize(s));
  }
});

test('computeId equals the CLI computeId for the same record (async ↔ sync agree)', async () => {
  const cliCore = require(path.join(repoRoot, 'cli', 'lib', 'core.js'));
  const { record } = makeSignedRecord();
  const bare = JSON.parse(JSON.stringify(record));
  delete bare.id;
  delete bare.provenance.signature;
  assert.strictEqual(await computeId(bare), cliCore.computeId(bare));
});

test('verifyRecord accepts a valid signed record', async () => {
  const { record } = makeSignedRecord();
  const res = await verifyRecord(record);
  assert.strictEqual(res.ok, true, res.errors.join('; '));
});

test('verifyRecord rejects a tampered body (both id and signature fail)', async () => {
  const { record } = makeSignedRecord();
  const tampered = JSON.parse(JSON.stringify(record));
  tampered.approach.summary = 'tampered after signing, should be rejected';
  const res = await verifyRecord(tampered);
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.length >= 2, 'both id mismatch and signature failure expected');
});

test('verifyRecord rejects a mismatched id even if the signature is valid', async () => {
  const { record } = makeSignedRecord();
  const bad = JSON.parse(JSON.stringify(record));
  bad.id = 'nr:sha256:' + '0'.repeat(64);
  const res = await verifyRecord(bad);
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('id mismatch')));
});

test('verifyRecord surfaces an unsupported identity scheme as an error, not a throw', async () => {
  const { record } = makeSignedRecord();
  const bad = JSON.parse(JSON.stringify(record));
  bad.provenance.author.identity = 'rsa:whatever';
  const res = await verifyRecord(bad);
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('signature check error')));
});

test('shardPath and canonicalBody exclusion parity', () => {
  assert.strictEqual(shardPath('nr:sha256:' + 'ab'.padEnd(64, '0')),
    'ab/' + 'ab'.padEnd(64, '0') + '.json');
  const r = { id: 'x', a: 1, provenance: { signature: 's', author: { identity: 'i' } } };
  assert.strictEqual(canonicalBody(r), '{"a":1,"provenance":{"author":{"identity":"i"}}}');
});
