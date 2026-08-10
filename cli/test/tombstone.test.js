'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const core = require('../lib/core.js');
const merkle = require('../lib/merkle.js');
const ckpt = require('../lib/checkpoint.js');
const tombstone = require('../lib/tombstone.js');

const REPO = path.join(__dirname, '..', '..');
const SCHEMA = JSON.parse(fs.readFileSync(
  path.join(REPO, 'spec', 'schema', 'nrs-tombstone-0.1.schema.json'), 'utf8'));

function mkTmp(p) { return fs.mkdtempSync(path.join(os.tmpdir(), p)); }

// A well-formed tombstone body for `id`, signed by `key` (defaults to the same
// key that will be pinned). `original` are the exact removed bytes.
function mkTombstone(id, original, key, over = {}) {
  const body = {
    tombstone_version: '0.1',
    id,
    redacted: true,
    grounds: 'secrets',
    statement: 'Removed: the record body contained a leaked API credential.',
    original_sha256: crypto.createHash('sha256').update(original).digest('hex'),
    redacted_at: '2026-08-10T00:00:00Z',
    key_id: core.identityFromPrivateKeyPem(key.privateKeyPem),
    ...over,
  };
  body.signature = tombstone.signTombstone(body, key.privateKeyPem);
  return body;
}

test('tombstone signature round-trips, is JCS field-order independent, and detects tamper', () => {
  const kp = core.generateKeypair();
  const id = 'nr:sha256:' + 'a'.repeat(64);
  const doc = mkTombstone(id, 'secret bytes\n', kp);
  assert.ok(tombstone.verifyTombstoneSignature(doc));
  // Reordered fields still verify — JCS sorts keys before signing.
  const reordered = { key_id: doc.key_id, signature: doc.signature, grounds: doc.grounds,
    id: doc.id, redacted: doc.redacted, statement: doc.statement, tombstone_version: doc.tombstone_version,
    original_sha256: doc.original_sha256, redacted_at: doc.redacted_at };
  assert.ok(tombstone.verifyTombstoneSignature(reordered));
  // Any body mutation invalidates the signature.
  assert.ok(!tombstone.verifyTombstoneSignature({ ...doc, grounds: 'personal_data' }));
  assert.ok(!tombstone.verifyTombstoneSignature({ ...doc, id: 'nr:sha256:' + 'b'.repeat(64) }));
});

test('validateTombstoneDoc: valid passes; wrong key, wrong hash, and bad grounds each fail', () => {
  const pinned = core.generateKeypair();
  const other = core.generateKeypair();
  const hex = 'c'.repeat(64);
  const id = 'nr:sha256:' + hex;
  const pinnedKey = pinned.identity;

  const good = mkTombstone(id, 'x', pinned);
  assert.deepStrictEqual(
    tombstone.validateTombstoneDoc(good, { schema: SCHEMA, pinnedKey, expectedHash: hex }), []);

  const wrongKey = mkTombstone(id, 'x', other);
  assert.ok(tombstone.validateTombstoneDoc(wrongKey, { schema: SCHEMA, pinnedKey, expectedHash: hex })
    .some((e) => /not the pinned checkpoint key/.test(e)));

  assert.ok(tombstone.validateTombstoneDoc(good, { schema: SCHEMA, pinnedKey, expectedHash: 'd'.repeat(64) })
    .some((e) => /id hash does not match filename/.test(e)));

  const badGrounds = mkTombstone(id, 'x', pinned, { grounds: 'wrongness' });
  assert.ok(tombstone.validateTombstoneDoc(badGrounds, { schema: SCHEMA, pinnedKey, expectedHash: hex }).length > 0);
});

// ---- Task 1.5: tombstoned ids remain Merkle leaves (checkpoints stay valid) ---

test('a tombstone preserves the leaf: root is unchanged and checkpoint.js no-ops (exit 3)', () => {
  const dir = mkTmp('nrts-leaf-');
  const kp = core.generateKeypair();
  const env = { ...process.env, CHECKPOINT_KEY_PEM: kp.privateKeyPem, SOURCE_DATE_EPOCH: '1765200000' };
  const run = (args) => execFileSync('node', args, { cwd: dir, env });
  const git = (args) => execFileSync('git', args, { cwd: dir,
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  try {
    for (const rel of ['cli/lib/core.js', 'cli/lib/merkle.js', 'cli/lib/checkpoint.js', 'cli/lib/validate.js',
      'cli/lib/tombstone.js', 'registry/scripts/checkpoint.js']) {
      fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
      fs.copyFileSync(path.join(REPO, rel), path.join(dir, rel));
    }
    const hex = 'a'.repeat(64);
    const id = 'nr:sha256:' + hex;
    const recPath = path.join(dir, 'registry', 'records', hex.slice(0, 2), hex + '.json');
    fs.mkdirSync(path.dirname(recPath), { recursive: true });
    fs.writeFileSync(recPath, JSON.stringify({ id, secret: 'do not keep me' }, null, 2) + '\n');
    git(['init', '-q']); git(['add', '-A']); git(['commit', '-q', '-m', 'record']);

    run(['registry/scripts/checkpoint.js']);
    const c1 = JSON.parse(fs.readFileSync(path.join(dir, 'checkpoints', '1.json'), 'utf8'));
    const rootBefore = merkle.computeRoot(ckpt.collectLeaves(dir));
    assert.strictEqual(c1.root, rootBefore);

    // Replace the body with a tombstone that preserves the id.
    const original = fs.readFileSync(recPath);
    fs.writeFileSync(recPath, JSON.stringify(mkTombstone(id, original, kp), null, 2) + '\n');
    git(['add', '-A']); git(['commit', '-q', '-m', 'tombstone']);

    // The leaf set and root are unchanged — the id is still a leaf.
    assert.deepStrictEqual(ckpt.collectLeaves(dir), [id]);
    assert.strictEqual(merkle.computeRoot(ckpt.collectLeaves(dir)), rootBefore);

    // Consequently a fresh checkpoint is a no-op (exit 3): root unchanged.
    let code = 0;
    try { run(['registry/scripts/checkpoint.js']); } catch (e) { code = e.status; }
    assert.strictEqual(code, 3, 'tombstoning must not change the root');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- Task 1.3: the four add-only transition tests via check-add-only.js -------

// A temp git repo carrying check-add-only.js + its deps, a pinned checkpoint key,
// and one committed record body. Returns handles for driving transitions.
function mkAddOnlyRepo() {
  const dir = mkTmp('nrts-addonly-');
  for (const rel of ['cli/lib/core.js', 'cli/lib/validate.js', 'cli/lib/tombstone.js',
    'registry/scripts/check-add-only.js', 'spec/schema/nrs-tombstone-0.1.schema.json']) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), path.join(dir, rel));
  }
  const kp = core.generateKeypair();
  fs.mkdirSync(path.join(dir, 'spec'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'spec', 'CHECKPOINT_KEY.pub'),
    '# pinned key for the test repo\n' + kp.identity + '\n');
  const hex = 'a'.repeat(64);
  const id = 'nr:sha256:' + hex;
  const rel = 'registry/records/' + hex.slice(0, 2) + '/' + hex + '.json';
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify({ id, secret: 'leaked token here' }, null, 2) + '\n');
  const git = (args) => execFileSync('git', args, { cwd: dir,
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git(['init', '-q']); git(['add', '-A']); git(['commit', '-q', '-m', 'record']);
  const base = git(['rev-parse', 'HEAD']).toString().trim();
  return { dir, kp, id, rel, abs, git, base };
}

function runCheck(dir, base, head) {
  try { execFileSync('node', ['registry/scripts/check-add-only.js', base, head], { cwd: dir, stdio: 'pipe' }); return 0; }
  catch (e) { return e.status; }
}

test('transition: a legal body → tombstone modification passes', () => {
  const r = mkAddOnlyRepo();
  try {
    const original = fs.readFileSync(r.abs);
    fs.writeFileSync(r.abs, JSON.stringify(mkTombstone(r.id, original, r.kp), null, 2) + '\n');
    r.git(['add', '-A']); r.git(['commit', '-q', '-m', 'tombstone']);
    const head = r.git(['rev-parse', 'HEAD']).toString().trim();
    assert.strictEqual(runCheck(r.dir, r.base, head), 0);
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('transition: a body → body modification fails', () => {
  const r = mkAddOnlyRepo();
  try {
    fs.writeFileSync(r.abs, JSON.stringify({ id: r.id, secret: 'edited, still a body' }, null, 2) + '\n');
    r.git(['add', '-A']); r.git(['commit', '-q', '-m', 'edit body']);
    const head = r.git(['rev-parse', 'HEAD']).toString().trim();
    assert.strictEqual(runCheck(r.dir, r.base, head), 1);
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('transition: tombstone → anything fails (tombstones are immutable)', () => {
  const r = mkAddOnlyRepo();
  try {
    // First, land a valid tombstone.
    const original = fs.readFileSync(r.abs);
    fs.writeFileSync(r.abs, JSON.stringify(mkTombstone(r.id, original, r.kp), null, 2) + '\n');
    r.git(['add', '-A']); r.git(['commit', '-q', '-m', 'tombstone']);
    const tombCommit = r.git(['rev-parse', 'HEAD']).toString().trim();
    // Then attempt to modify the tombstone — even into another valid-looking tombstone.
    const original2 = fs.readFileSync(r.abs);
    fs.writeFileSync(r.abs, JSON.stringify(
      mkTombstone(r.id, original2, r.kp, { statement: 'Reworded after the fact.' }), null, 2) + '\n');
    r.git(['add', '-A']); r.git(['commit', '-q', '-m', 'edit tombstone']);
    const head = r.git(['rev-parse', 'HEAD']).toString().trim();
    assert.strictEqual(runCheck(r.dir, tombCommit, head), 1);
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('transition: a tombstone signed with the wrong key fails', () => {
  const r = mkAddOnlyRepo();
  try {
    const wrong = core.generateKeypair(); // not the pinned key
    const original = fs.readFileSync(r.abs);
    fs.writeFileSync(r.abs, JSON.stringify(mkTombstone(r.id, original, wrong), null, 2) + '\n');
    r.git(['add', '-A']); r.git(['commit', '-q', '-m', 'tombstone wrong key']);
    const head = r.git(['rev-parse', 'HEAD']).toString().trim();
    assert.strictEqual(runCheck(r.dir, r.base, head), 1);
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});
