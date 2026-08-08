'use strict';
// Build and sign the next NRS-C-0.1 checkpoint over the current registry state.
//
//   CHECKPOINT_KEY_PEM=<pkcs8 pem> node registry/scripts/checkpoint.js
//
// Writes checkpoints/<n>.json (n = previous + 1) and overwrites checkpoints/
// latest.json to match. Refuses (exit 3) if the Merkle root is unchanged since
// the last checkpoint — no empty/no-op checkpoints. Exit 1 on any real error.
// See spec/CHECKPOINT.md.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const core = require('../../cli/lib/core.js');
const merkle = require('../../cli/lib/merkle.js');
const ckpt = require('../../cli/lib/checkpoint.js');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CK_DIR = path.join(REPO_ROOT, 'checkpoints');
const PUB_PATH = path.join(REPO_ROOT, 'spec', 'CHECKPOINT_KEY.pub');
const EXIT_NOOP = 3;

function fail(msg) { console.error('checkpoint: ' + msg); process.exit(1); }

const pem = process.env.CHECKPOINT_KEY_PEM;
if (!pem) fail('CHECKPOINT_KEY_PEM is required (the checkpoint signing private key, PKCS8 PEM).');

let keyId;
try { keyId = core.identityFromPrivateKeyPem(pem); }
catch (e) { fail('CHECKPOINT_KEY_PEM is not a valid Ed25519 PKCS8 private key: ' + e.message); }

function gitCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT }).toString().trim(); }
  catch { return 'unknown'; }
}

// Timestamp with second precision (matching the record style). SOURCE_DATE_EPOCH
// makes a run reproducible when set (used by tests); otherwise wall clock.
function createdIso() {
  const ms = process.env.SOURCE_DATE_EPOCH ? Number(process.env.SOURCE_DATE_EPOCH) * 1000 : Date.now();
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const leaves = ckpt.collectLeaves(REPO_ROOT);
if (leaves.length === 0) fail('registry is empty — nothing to checkpoint.');
const root = merkle.computeRoot(leaves);

fs.mkdirSync(CK_DIR, { recursive: true });
const numbered = fs.readdirSync(CK_DIR)
  .filter((f) => /^\d+\.json$/.test(f))
  .map((f) => parseInt(f, 10))
  .sort((a, b) => a - b);
const lastN = numbered.length ? numbered[numbered.length - 1] : 0;

let prevHash = null;
if (lastN > 0) {
  const prevBytes = fs.readFileSync(path.join(CK_DIR, lastN + '.json'));
  const prevDoc = JSON.parse(prevBytes.toString('utf8'));
  if (prevDoc.root === root) {
    console.log('checkpoint: root unchanged since checkpoint ' + lastN + ' (' + leaves.length +
      ' leaves) — nothing to do.');
    process.exit(EXIT_NOOP);
  }
  prevHash = crypto.createHash('sha256').update(prevBytes).digest('hex');
}

const n = lastN + 1;
const body = {
  checkpoint_version: ckpt.CHECKPOINT_VERSION,
  origin: ckpt.ORIGIN,
  size: leaves.length,
  root,
  created: createdIso(),
  git_commit: gitCommit(),
  prev_checkpoint: prevHash,
  key_id: keyId,
};
const signature = ckpt.signCheckpoint(body, pem);

// Emit in the documented field order for readability (JCS signs regardless).
const doc = {
  checkpoint_version: body.checkpoint_version,
  origin: body.origin,
  size: body.size,
  root: body.root,
  created: body.created,
  git_commit: body.git_commit,
  prev_checkpoint: body.prev_checkpoint,
  signature,
  key_id: body.key_id,
};
const text = JSON.stringify(doc, null, 2) + '\n';
fs.writeFileSync(path.join(CK_DIR, n + '.json'), text);
fs.writeFileSync(path.join(CK_DIR, 'latest.json'), text);

// First keyed run publishes the public identity so the repo pins the key.
const pubHasKey = fs.existsSync(PUB_PATH) && /ed25519:[A-Za-z0-9_-]+/.test(fs.readFileSync(PUB_PATH, 'utf8'));
if (!pubHasKey) {
  fs.mkdirSync(path.dirname(PUB_PATH), { recursive: true });
  fs.writeFileSync(PUB_PATH,
    '# Null Registry checkpoint signing key (NRS-C-0.1) — Ed25519 public identity.\n' +
    '# Pinned here so any clone can confirm which key signs the log. See spec/CHECKPOINT.md.\n' +
    keyId + '\n');
  console.log('checkpoint: wrote public key identity to ' + path.relative(REPO_ROOT, PUB_PATH));
}

console.log('checkpoint: wrote ' + path.relative(REPO_ROOT, path.join(CK_DIR, n + '.json')) +
  ' and latest.json');
console.log('  size:  ' + leaves.length + ' leaves');
console.log('  root:  ' + root);
console.log('  prev:  ' + (prevHash || 'null (genesis)'));
console.log('  key:   ' + keyId);
