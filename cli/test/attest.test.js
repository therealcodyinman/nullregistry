'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const core = require('../lib/core.js');
const { validate } = require('../lib/validate.js');

const CLI = path.join(__dirname, '..', 'bin', 'nullreg.js');
const verifSchema = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', 'spec', 'schema', 'nrs-verification-0.1.schema.json'), 'utf8'));

function mkTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

// Build a real, signed null record inside a fresh temp repo and return its id + root.
function seedTmpRepo() {
  const repo = mkTmp('nrrepo-');
  const kp = core.generateKeypair();
  const record = {
    nrs_version: '0.1',
    created: '2026-08-07T00:00:00Z',
    problem: { statement: 'A documented dead end used only for attest tests.', fingerprint: { domain: 'software', tags: ['test'] } },
    approach: { summary: 'Attempted the thing.' },
    failure: { mode: 'incorrect_result', point: 'It broke here.', evidence: 'Observed error output.' },
    transferability: { scope: 'unknown', notes: 'Test fixture.' },
    confidence: { level: 'anecdotal' },
    provenance: { author: { type: 'agent', identity: kp.identity } },
  };
  record.id = core.computeId(record);
  record.provenance.signature = core.signRecord(record, kp.privateKeyPem);
  const dest = path.join(repo, 'registry', 'records', core.shardPath(record.id));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(record, null, 2) + '\n');
  return { repo, id: record.id };
}

// A temp home with a generated identity; returns an env pointing homedir at it.
function keygenHome() {
  const home = mkTmp('nrhome-');
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  execFileSync(process.execPath, [CLI, 'keygen'], { env, stdio: 'pipe' });
  return env;
}

test('attest: produces a schema-valid, signature-verifiable verification file', () => {
  const { repo, id } = seedTmpRepo();
  const env = keygenHome();
  execFileSync(process.execPath, [CLI, 'attest', id,
    '--verdict', 'confirmed',
    '--evidence', 'Re-ran the approach and the same failure surfaced.',
    '--env', 'ubuntu 22.04, node 22',
    '--repo', repo], { env, stdio: 'pipe' });

  const vDir = path.join(repo, 'registry', 'verifications');
  const files = fs.readdirSync(vDir, { recursive: true }).filter((f) => String(f).endsWith('.json'));
  assert.strictEqual(files.length, 1, 'exactly one verification written');
  const v = JSON.parse(fs.readFileSync(path.join(vDir, files[0]), 'utf8'));

  assert.strictEqual(validate(verifSchema, v).length, 0, 'produced file must be schema-valid');
  assert.strictEqual(core.verifyVerification(v).ok, true, 'id + signature must round-trip');
  assert.strictEqual(v.references, id);
  assert.strictEqual(v.verdict, 'confirmed');
  assert.match(v.id, /^nrv:sha256:[0-9a-f]{64}$/);
  // Filename must equal the hash, mirroring the record convention CI enforces.
  assert.strictEqual(path.basename(files[0]), v.id.split(':')[2] + '.json');
});

test('attest: --author-type flows through; refuted verdict supported', () => {
  const { repo, id } = seedTmpRepo();
  const env = keygenHome();
  execFileSync(process.execPath, [CLI, 'attest', id,
    '--verdict', 'refuted', '--author-type', 'human',
    '--evidence', 'Could not reproduce; the approach worked in my environment.',
    '--env', 'macOS 14, node 22', '--repo', repo], { env, stdio: 'pipe' });
  const vDir = path.join(repo, 'registry', 'verifications');
  const file = fs.readdirSync(vDir, { recursive: true }).find((f) => String(f).endsWith('.json'));
  const v = JSON.parse(fs.readFileSync(path.join(vDir, file), 'utf8'));
  assert.strictEqual(v.verdict, 'refuted');
  assert.strictEqual(v.provenance.author.type, 'human');
});

test('attest: refuses a reference not present locally', () => {
  const { repo } = seedTmpRepo();
  const env = keygenHome();
  const bogus = 'nr:sha256:' + '0'.repeat(64);
  assert.throws(() => {
    execFileSync(process.execPath, [CLI, 'attest', bogus,
      '--verdict', 'confirmed',
      '--evidence', 'This should never be written.',
      '--env', 'ubuntu 22.04', '--repo', repo], { env, stdio: 'pipe' });
  }, 'unknown reference must exit non-zero');
  const vDir = path.join(repo, 'registry', 'verifications');
  assert.strictEqual(fs.existsSync(vDir), false, 'no verification file written on refusal');
});

test('attest: rejects an invalid verdict', () => {
  const { repo, id } = seedTmpRepo();
  const env = keygenHome();
  assert.throws(() => {
    execFileSync(process.execPath, [CLI, 'attest', id,
      '--verdict', 'maybe', '--evidence', 'ten chars plus', '--env', 'x', '--repo', repo],
      { env, stdio: 'pipe' });
  });
});

test('computeVerificationId + verifyVerification round-trip and tamper detection', () => {
  const kp = core.generateKeypair();
  const v = {
    nrs_version: '0.1', created: '2026-08-07T00:00:00Z',
    references: 'nr:sha256:' + 'a'.repeat(64), verdict: 'confirmed',
    environment: { description: 'test env' }, evidence: 'reproduced the failure',
    provenance: { author: { type: 'agent', identity: kp.identity } },
  };
  v.id = core.computeVerificationId(v);
  v.provenance.signature = core.signRecord(v, kp.privateKeyPem);
  assert.match(v.id, /^nrv:sha256:[0-9a-f]{64}$/);
  assert.strictEqual(core.verifyVerification(v).ok, true);
  const tampered = JSON.parse(JSON.stringify(v));
  tampered.verdict = 'refuted';
  const res = core.verifyVerification(tampered);
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.length >= 2, 'both id and signature must fail on tamper');
});
