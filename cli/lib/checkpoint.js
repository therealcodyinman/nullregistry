'use strict';
// NRS-C-0.1 checkpoint document helpers (see spec/CHECKPOINT.md).
//
// A checkpoint is a signed statement of the Merkle root over every record and
// verification id in the registry at a point in time. This module owns the parts
// shared by the builder (registry/scripts/checkpoint.js), the auditor
// (registry/scripts/verify-checkpoint.js), and the client (`nullreg root` /
// `nullreg prove`): collecting sorted leaves, and signing/verifying the doc.
const fs = require('node:fs');
const path = require('node:path');
const core = require('./core.js');

const CHECKPOINT_VERSION = '0.1';
const ORIGIN = 'nullregistry.org';

// Every record and verification, as its `id` string, sorted lexicographically by
// UTF-16 code unit (JS default). ids are pure ASCII, so this equals byte order;
// all `nr:` sort before all `nrv:`. The id is the leaf — it is already a content
// hash, which keeps proofs tiny and independent of file bytes or path layout.
function collectLeaves(repoRoot) {
  const leaves = [];
  for (const sub of ['records', 'verifications']) {
    const dir = path.join(repoRoot, 'registry', sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir, { recursive: true })) {
      if (!String(f).endsWith('.json')) continue;
      const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      leaves.push(rec.id);
    }
  }
  leaves.sort();
  return leaves;
}

// The signed content is the checkpoint object minus its `signature`, serialized
// per RFC 8785 (JCS). Field order in the file is irrelevant — JCS sorts keys.
function signedBytes(doc) {
  const clone = { ...doc };
  delete clone.signature;
  return core.canonicalize(clone);
}

function signCheckpoint(body, privateKeyPem) {
  return core.signDetached(signedBytes(body), privateKeyPem);
}

// Returns true iff the doc's Ed25519 signature verifies under its own key_id.
function verifyCheckpointSignature(doc) {
  if (!doc || typeof doc.signature !== 'string' || typeof doc.key_id !== 'string') return false;
  try {
    return core.verifyDetached(signedBytes(doc), doc.signature, doc.key_id);
  } catch {
    return false;
  }
}

module.exports = { CHECKPOINT_VERSION, ORIGIN, collectLeaves, signedBytes,
  signCheckpoint, verifyCheckpointSignature };
