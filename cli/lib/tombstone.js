'use strict';
// NRS-TS-0.1 tombstone helpers (see spec/TOMBSTONE.md).
//
// A tombstone replaces a record or verification body in place — same path, same
// filename, same `id` — reducing a hazardous payload (secrets, personal data,
// harm-enabling content) to a signed commitment. Because v2 Merkle leaves are
// record ids, not file bytes, preserving `id` keeps every checkpoint and
// inclusion proof valid. A tombstone is an operator act: it is signed by the
// checkpoint key (spec/CHECKPOINT_KEY.pub), never by a contributor key.
const core = require('./core.js');
const { validate } = require('./validate.js');

const TOMBSTONE_VERSION = '0.1';

function isTombstone(obj) {
  return !!obj && typeof obj === 'object' && obj.tombstone_version !== undefined;
}

// The signed content is the tombstone object minus its `signature`, serialized
// per RFC 8785 (JCS). Unlike a null record — whose `id` is derived from and thus
// excluded from the signed body — a tombstone's `id` is a preserved constant and
// stays inside the signed body. This mirrors the checkpoint signing scheme, so
// one detached-signature code path (core.signDetached/verifyDetached) backs all.
function signedBytes(doc) {
  const clone = { ...doc };
  delete clone.signature;
  return core.canonicalize(clone);
}

function signTombstone(body, privateKeyPem) {
  return core.signDetached(signedBytes(body), privateKeyPem);
}

// True iff the doc's Ed25519 signature verifies under its own embedded key_id.
function verifyTombstoneSignature(doc) {
  if (!doc || typeof doc.signature !== 'string' || typeof doc.key_id !== 'string') return false;
  try {
    return core.verifyDetached(signedBytes(doc), doc.signature, doc.key_id);
  } catch {
    return false;
  }
}

// Full structural + cryptographic validation of a committed tombstone:
//   - schema conformance (nrs-tombstone-0.1),
//   - the id's hash matches the filename it replaces (`expectedHash`),
//   - key_id equals the pinned checkpoint key (operator authority), and
//   - the signature verifies under key_id.
// Returns an array of error strings (empty === valid).
function validateTombstoneDoc(doc, { schema, pinnedKey, expectedHash } = {}) {
  const errors = schema ? validate(schema, doc) : [];
  if (typeof doc.id === 'string') {
    const hex = doc.id.split(':')[2];
    if (expectedHash && hex !== expectedHash) {
      errors.push('id hash does not match filename (expected ' + expectedHash + ')');
    }
  }
  if (!pinnedKey) {
    errors.push('no pinned checkpoint key (spec/CHECKPOINT_KEY.pub) — cannot authorize a tombstone');
  } else if (doc.key_id !== pinnedKey) {
    errors.push('tombstone key_id is not the pinned checkpoint key');
  }
  if (!verifyTombstoneSignature(doc)) {
    errors.push('tombstone signature does not verify under its key_id');
  }
  return errors;
}

module.exports = { TOMBSTONE_VERSION, isTombstone, signedBytes, signTombstone,
  verifyTombstoneSignature, validateTombstoneDoc };
