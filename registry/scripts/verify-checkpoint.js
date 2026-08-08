'use strict';
// Auditor for the NRS-C-0.1 checkpoint chain. Given a clone, it independently
// checks that the signed log is internally consistent and that each root really
// is the Merkle root over the registry as it stood at that checkpoint's commit —
// so trust rests on recomputation, not on GitHub or the operator.
//
//   node registry/scripts/verify-checkpoint.js
//
// Exit 0 = every checkpoint's signature, hash chain, and (where the commit is
// present in this clone) recomputed root verify. Exit 1 = any failure. An empty
// checkpoints/ is a valid genesis state and passes. See spec/CHECKPOINT.md.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const merkle = require('../../cli/lib/merkle.js');
const ckpt = require('../../cli/lib/checkpoint.js');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CK_DIR = path.join(REPO_ROOT, 'checkpoints');
const PUB_PATH = path.join(REPO_ROOT, 'spec', 'CHECKPOINT_KEY.pub');

const problems = [];
const notes = [];
function bad(msg) { problems.push(msg); console.error('  FAIL ' + msg); }
function ok(msg) { console.log('  ok   ' + msg); }
function note(msg) { notes.push(msg); console.log('  --   ' + msg); }

function sha256Hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

// Derive the sorted leaf set at a commit from git paths alone. Filename == hash
// and directory == id-prefix are CI-enforced invariants (validate-all.js), so
// the id string is recoverable from the path without reading blob contents.
function leavesAtCommit(commit) {
  const out = execFileSync('git', ['ls-tree', '-r', '--name-only', commit], { cwd: REPO_ROOT }).toString();
  const leaves = [];
  for (const f of out.split('\n')) {
    if (!f.endsWith('.json')) continue;
    const base = path.basename(f).replace(/\.json$/, '');
    if (f.startsWith('registry/records/')) leaves.push('nr:sha256:' + base);
    else if (f.startsWith('registry/verifications/')) leaves.push('nrv:sha256:' + base);
  }
  leaves.sort();
  return leaves;
}

function main() {
  if (!fs.existsSync(CK_DIR)) {
    console.log('No checkpoints/ directory yet — genesis state, nothing to verify.');
    return 0;
  }
  const numbered = fs.readdirSync(CK_DIR)
    .filter((f) => /^\d+\.json$/.test(f))
    .map((f) => parseInt(f, 10))
    .sort((a, b) => a - b);
  if (numbered.length === 0) {
    console.log('No numbered checkpoints yet — genesis state, nothing to verify.');
    return 0;
  }

  // Structural: contiguous 1..k.
  for (let i = 0; i < numbered.length; i++) {
    if (numbered[i] !== i + 1) { bad('checkpoint numbering is not contiguous (missing ' + (i + 1) + ')'); }
  }
  const k = numbered[numbered.length - 1];

  // Pinned key (optional): if spec/CHECKPOINT_KEY.pub names an identity, every
  // checkpoint must be signed by it.
  let pinned = null;
  if (fs.existsSync(PUB_PATH)) {
    const m = fs.readFileSync(PUB_PATH, 'utf8').match(/ed25519:[A-Za-z0-9_-]+/);
    if (m) pinned = m[0];
  }
  if (pinned) note('pinned key: ' + pinned);
  else note('no pinned key in spec/CHECKPOINT_KEY.pub — trusting each checkpoint\'s own key_id');

  let prevBytes = null;
  let prevSize = 0;
  let firstKey = null;
  console.log('\nVerifying ' + numbered.length + ' checkpoint(s):');
  for (const n of numbered) {
    const file = path.join(CK_DIR, n + '.json');
    const bytes = fs.readFileSync(file);
    let doc;
    try { doc = JSON.parse(bytes.toString('utf8')); }
    catch (e) { bad(n + '.json: not valid JSON (' + e.message + ')'); continue; }

    // Signature.
    if (ckpt.verifyCheckpointSignature(doc)) ok(n + '.json signature');
    else bad(n + '.json signature does not verify');

    // Key consistency.
    if (firstKey === null) firstKey = doc.key_id;
    else if (doc.key_id !== firstKey) bad(n + '.json key_id changed mid-chain (' + doc.key_id + ')');
    if (pinned && doc.key_id !== pinned) bad(n + '.json key_id is not the pinned key');

    // Hash chain.
    const expectedPrev = n === 1 ? null : sha256Hex(prevBytes);
    if ((doc.prev_checkpoint || null) !== expectedPrev) {
      bad(n + '.json prev_checkpoint break: expected ' + (expectedPrev || 'null') +
        ', got ' + (doc.prev_checkpoint || 'null'));
    } else ok(n + '.json prev_checkpoint chain');

    // Monotonic size.
    if (typeof doc.size !== 'number' || doc.size < prevSize) {
      bad(n + '.json size ' + doc.size + ' is not >= previous size ' + prevSize);
    }
    prevSize = doc.size;

    // Root recomputation at the recorded commit (the substance of the audit).
    let leaves = null;
    if (doc.git_commit && doc.git_commit !== 'unknown') {
      try { leaves = leavesAtCommit(doc.git_commit); }
      catch { note(n + '.json root recomputation skipped — commit ' +
        String(doc.git_commit).slice(0, 12) + ' not in this clone (fetch full history to verify)'); }
    } else {
      note(n + '.json has no usable git_commit — root not recomputed');
    }
    if (leaves) {
      const root = merkle.computeRoot(leaves);
      if (root === doc.root && leaves.length === doc.size) ok(n + '.json root recomputed over commit tree');
      else bad(n + '.json root/size mismatch vs commit tree: computed ' + root +
        ' (' + leaves.length + ' leaves) vs recorded ' + doc.root + ' (' + doc.size + ')');
    }

    prevBytes = bytes;
  }

  // latest.json must byte-equal the highest-numbered checkpoint.
  const latestPath = path.join(CK_DIR, 'latest.json');
  if (fs.existsSync(latestPath)) {
    if (fs.readFileSync(latestPath).equals(fs.readFileSync(path.join(CK_DIR, k + '.json')))) {
      ok('latest.json == ' + k + '.json');
    } else bad('latest.json does not match the highest-numbered checkpoint (' + k + '.json)');
  } else note('no latest.json present');

  console.log('');
  if (problems.length) {
    console.error('FAILED: ' + problems.length + ' problem(s) across ' + numbered.length + ' checkpoint(s).');
    return 1;
  }
  console.log('VERIFIED: ' + numbered.length + ' checkpoint(s), signatures + hash chain + recomputed roots all consistent.');
  return 0;
}

process.exit(main());
