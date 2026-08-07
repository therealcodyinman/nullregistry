'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../lib/core.js');
const { validate } = require('../lib/validate.js');

const schema = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', 'spec', 'schema', 'nrs-0.1.schema.json'), 'utf8'));

test('canonicalize: sorts keys recursively (RFC 8785)', () => {
  assert.strictEqual(core.canonicalize({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
});

test('canonicalize: arrays preserve order, no whitespace', () => {
  assert.strictEqual(core.canonicalize([3, 1, { z: true, a: null }]), '[3,1,{"a":null,"z":true}]');
});

test('canonicalize: string escaping matches JSON', () => {
  assert.strictEqual(core.canonicalize({ s: 'a"b\n\u0001' }), '{"s":"a\\"b\\n\\u0001"}');
});

test('canonicalize: RFC 8785 integer and literal vectors', () => {
  assert.strictEqual(core.canonicalize(1000000), '1000000');
  assert.strictEqual(core.canonicalize(1e30), '1e+30');
  assert.strictEqual(core.canonicalize(true), 'true');
  assert.throws(() => core.canonicalize(NaN));
});

test('canonicalBody excludes id and signature but nothing else', () => {
  const r = { id: 'x', a: 1, provenance: { signature: 's', author: { identity: 'i' } } };
  assert.strictEqual(core.canonicalBody(r), '{"a":1,"provenance":{"author":{"identity":"i"}}}');
});

test('computeId is stable and content-addressed', () => {
  const a = { nrs_version: '0.1', problem: { statement: 'stable hashing test record' } };
  const id1 = core.computeId(a);
  const id2 = core.computeId(JSON.parse(JSON.stringify(a)));
  assert.strictEqual(id1, id2);
  assert.match(id1, /^nr:sha256:[0-9a-f]{64}$/);
  a.problem.statement += '!';
  assert.notStrictEqual(core.computeId(a), id1);
});

test('sign/verify round-trip, tamper detection', () => {
  const kp = core.generateKeypair();
  const record = { nrs_version: '0.1', approach: { summary: 'roundtrip' },
    provenance: { author: { type: 'agent', identity: kp.identity } } };
  record.id = core.computeId(record);
  record.provenance.signature = core.signRecord(record, kp.privateKeyPem);
  assert.strictEqual(core.verifyRecord(record).ok, true);
  const tampered = JSON.parse(JSON.stringify(record));
  tampered.approach.summary = 'tampered';
  const result = core.verifyRecord(tampered);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.length >= 2, 'both id and signature must fail on tamper');
});

test('shardPath uses first two hex chars', () => {
  assert.strictEqual(core.shardPath('nr:sha256:' + 'ab'.padEnd(64, '0')),
    'ab/' + 'ab'.padEnd(64, '0') + '.json');
});

test('schema: rejects missing transferability and unknown fields', () => {
  const seedFile = fs.readdirSync(path.join(__dirname, '..', '..', 'registry', 'records'), { recursive: true })
    .filter((f) => f.endsWith('.json'))[0];
  const good = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'registry', 'records', seedFile), 'utf8'));
  assert.strictEqual(validate(schema, good).length, 0, 'seed record must validate');
  const noTransfer = JSON.parse(JSON.stringify(good));
  delete noTransfer.transferability;
  assert.ok(validate(schema, noTransfer).some((e) => e.includes('transferability')));
  const extra = JSON.parse(JSON.stringify(good));
  extra.vibes = 'immaculate';
  assert.ok(validate(schema, extra).some((e) => e.includes('additional property')));
});

test('schema: enums enforced', () => {
  const seedFile = fs.readdirSync(path.join(__dirname, '..', '..', 'registry', 'records'), { recursive: true })
    .filter((f) => f.endsWith('.json'))[0];
  const r = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'registry', 'records', seedFile), 'utf8'));
  r.failure.mode = 'skill_issue';
  assert.ok(validate(schema, r).some((e) => e.includes('enum')));
});
