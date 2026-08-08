'use strict';
const crypto = require('node:crypto');

// --- Minimal RFC 8785 (JCS) canonicalization -------------------------------
// Sufficient for NRS records: objects, arrays, strings, numbers (integers),
// booleans, null. Number serialization follows ECMAScript ToString, which
// matches RFC 8785 for the integer and common-double cases used here.
function canonicalize(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite numbers are not permitted');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
  }
  throw new Error('Unsupported type: ' + typeof value);
}

// --- Canonical body: record minus id and provenance.signature ---------------
function canonicalBody(record) {
  const clone = JSON.parse(JSON.stringify(record));
  delete clone.id;
  if (clone.provenance) delete clone.provenance.signature;
  return canonicalize(clone);
}

function hashCanonicalBody(record) {
  return crypto.createHash('sha256').update(canonicalBody(record), 'utf8').digest('hex');
}

function computeId(record) {
  return 'nr:sha256:' + hashCanonicalBody(record);
}

// Verification records (NRS-V-0.1) share the exact canonicalization, hashing,
// and signing construction as null records — only the id prefix differs.
function computeVerificationId(record) {
  return 'nrv:sha256:' + hashCanonicalBody(record);
}

function shardPath(id) {
  const hex = id.split(':')[2];
  return hex.slice(0, 2) + '/' + hex + '.json';
}

// --- Ed25519 identity, signing, verification --------------------------------
function generateKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    identity: 'ed25519:' + publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
  };
}

function keyFromIdentity(identity) {
  if (!identity.startsWith('ed25519:')) throw new Error('Unsupported identity scheme');
  const der = Buffer.from(identity.slice('ed25519:'.length), 'base64url');
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}

function signRecord(record, privateKeyPem) {
  const sig = crypto.sign(null, Buffer.from(canonicalBody(record), 'utf8'),
    crypto.createPrivateKey(privateKeyPem));
  return sig.toString('base64url');
}

// Signature check over the canonical body, independent of the id prefix.
// Shared by null-record and verification-record verifiers.
function checkSignature(record) {
  const key = keyFromIdentity(record.provenance.author.identity);
  return crypto.verify(null, Buffer.from(canonicalBody(record), 'utf8'), key,
    Buffer.from(record.provenance.signature, 'base64url'));
}

function verifyWithExpectedId(record, expected) {
  const errors = [];
  if (record.id !== expected) errors.push(`id mismatch: expected ${expected}`);
  try {
    if (!checkSignature(record)) errors.push('signature verification failed');
  } catch (e) {
    errors.push('signature check error: ' + e.message);
  }
  return { ok: errors.length === 0, errors };
}

function verifyRecord(record) {
  return verifyWithExpectedId(record, computeId(record));
}

// --- Proof-of-work stamp (NRS-T-0.1) ----------------------------------------
// The accountless inbox transport prices spam in CPU: a stamp is a nonce whose
// SHA-256(id + ":" + nonce) has >= `bits` leading zero bits. The stamp lives in
// the submission envelope, never in the record (see spec/TRANSPORT.md).
function leadingZeroBits(buf) {
  let count = 0;
  for (const b of buf) {
    if (b === 0) { count += 8; continue; }
    count += Math.clz32(b) - 24; // b is 1..255 here → 0..7 leading zeros
    break;
  }
  return count;
}

function stampBits(id, nonce) {
  return leadingZeroBits(crypto.createHash('sha256').update(id + ':' + nonce, 'utf8').digest());
}

// Search decimal nonces until one meets the difficulty. Returns the envelope
// stamp object.
function computeStamp(id, bits) {
  let n = 0;
  while (stampBits(id, String(n)) < bits) n++;
  return { algo: 'sha256-lead0', bits, nonce: String(n) };
}

function verifyVerification(record) {
  return verifyWithExpectedId(record, computeVerificationId(record));
}

module.exports = { canonicalize, canonicalBody, hashCanonicalBody, computeId,
  computeVerificationId, shardPath, generateKeypair, keyFromIdentity, signRecord,
  verifyRecord, verifyVerification, leadingZeroBits, stampBits, computeStamp };
