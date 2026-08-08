'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const core = require('../lib/core.js');
const merkle = require('../lib/merkle.js');
const ckpt = require('../lib/checkpoint.js');

test('checkpoint key_id derives from the private key and matches the identity scheme', () => {
  const kp = core.generateKeypair();
  assert.strictEqual(core.identityFromPrivateKeyPem(kp.privateKeyPem), kp.identity);
  assert.match(kp.identity, /^ed25519:[A-Za-z0-9_-]+$/);
});

test('checkpoint signature round-trips and is bound to the body (JCS)', () => {
  const kp = core.generateKeypair();
  const leaves = ['nr:sha256:' + 'a'.repeat(64), 'nrv:sha256:' + 'b'.repeat(64)];
  const body = {
    checkpoint_version: '0.1', origin: 'nullregistry.org', size: 2,
    root: merkle.computeRoot(leaves), created: '2026-08-08T00:00:00Z',
    git_commit: 'deadbeef', prev_checkpoint: null,
    key_id: core.identityFromPrivateKeyPem(kp.privateKeyPem),
  };
  const doc = { ...body, signature: ckpt.signCheckpoint(body, kp.privateKeyPem) };
  assert.ok(ckpt.verifyCheckpointSignature(doc));
  // Field order in the file is irrelevant — JCS sorts keys before signing.
  const reordered = { signature: doc.signature, key_id: doc.key_id, root: doc.root,
    origin: doc.origin, size: doc.size, checkpoint_version: doc.checkpoint_version,
    created: doc.created, git_commit: doc.git_commit, prev_checkpoint: doc.prev_checkpoint };
  assert.ok(ckpt.verifyCheckpointSignature(reordered));
  // Any body mutation invalidates the signature.
  assert.ok(!ckpt.verifyCheckpointSignature({ ...doc, root: '0'.repeat(64) }));
  assert.ok(!ckpt.verifyCheckpointSignature({ ...doc, size: 3 }));
});

test('build → verify a two-checkpoint chain in a temp git repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrckpt-'));
  const kp = core.generateKeypair();
  const env = { ...process.env, CHECKPOINT_KEY_PEM: kp.privateKeyPem, SOURCE_DATE_EPOCH: '1765200000' };
  const run = (args, extraEnv) => execFileSync('node', args, { cwd: dir, env: { ...env, ...extraEnv } });
  const git = (args) => execFileSync('git', args, { cwd: dir,
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });

  try {
    // Lay out a minimal repo: the scripts + libs they require, plus a record.
    const repo = path.join(__dirname, '..', '..');
    for (const rel of ['cli/lib/core.js', 'cli/lib/merkle.js', 'cli/lib/checkpoint.js', 'cli/lib/validate.js',
      'registry/scripts/checkpoint.js', 'registry/scripts/verify-checkpoint.js']) {
      fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
      fs.copyFileSync(path.join(repo, rel), path.join(dir, rel));
    }
    const mkRecord = (hex) => {
      const id = 'nr:sha256:' + hex;
      const p = path.join(dir, 'registry', 'records', hex.slice(0, 2));
      fs.mkdirSync(p, { recursive: true });
      fs.writeFileSync(path.join(p, hex + '.json'), JSON.stringify({ id }) + '\n');
    };
    mkRecord('a'.repeat(64));
    git(['init', '-q']);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'one record']);

    run(['registry/scripts/checkpoint.js']);
    assert.ok(fs.existsSync(path.join(dir, 'checkpoints', '1.json')));
    assert.ok(fs.existsSync(path.join(dir, 'checkpoints', 'latest.json')));
    assert.ok(/ed25519:/.test(fs.readFileSync(path.join(dir, 'spec', 'CHECKPOINT_KEY.pub'), 'utf8')));
    const c1 = JSON.parse(fs.readFileSync(path.join(dir, 'checkpoints', '1.json'), 'utf8'));
    assert.strictEqual(c1.size, 1);
    assert.strictEqual(c1.prev_checkpoint, null);
    assert.ok(ckpt.verifyCheckpointSignature(c1));

    // No-op: root unchanged → exit 3, no second checkpoint.
    let noop;
    try { run(['registry/scripts/checkpoint.js']); noop = 0; }
    catch (e) { noop = e.status; }
    assert.strictEqual(noop, 3, 'unchanged root must refuse with exit 3');

    // Add a record, commit, checkpoint again → chained checkpoint 2.
    git(['add', '-A']); git(['commit', '-q', '-m', 'checkpoint 1']);
    mkRecord('b'.repeat(64));
    git(['add', '-A']); git(['commit', '-q', '-m', 'second record']);
    run(['registry/scripts/checkpoint.js']);
    const c2 = JSON.parse(fs.readFileSync(path.join(dir, 'checkpoints', '2.json'), 'utf8'));
    assert.strictEqual(c2.size, 2);
    assert.ok(c2.prev_checkpoint && c2.prev_checkpoint.length === 64, 'checkpoint 2 chains to 1');

    // The auditor passes on the full clone.
    const out = run(['registry/scripts/verify-checkpoint.js']).toString();
    assert.match(out, /VERIFIED: 2 checkpoint\(s\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('prove/verify inclusion round-trips against a checkpoint root', () => {
  const leaves = Array.from({ length: 12 }, (_, i) => 'nr:sha256:' + String(i).padStart(64, '0'));
  const root = merkle.computeRoot(leaves);
  const idx = 7;
  const proof = { leaf: leaves[idx], leaf_index: idx, tree_size: leaves.length,
    path: merkle.inclusionProof(leaves, idx), root, checkpoint: { root, size: leaves.length } };
  assert.ok(merkle.verifyInclusion(proof.leaf, proof.path, proof.root));
  assert.strictEqual(proof.checkpoint.root, proof.root);
});
