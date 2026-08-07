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

function computeId(record) {
  const hash = crypto.createHash('sha256').update(canonicalBody(record), 'utf8').digest('hex');
  return 'nr:sha256:' + hash;
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

function verifyRecord(record) {
  const errors = [];
  const expected = computeId(record);
  if (record.id !== expected) errors.push(`id mismatch: expected ${expected}`);
  try {
    const key = keyFromIdentity(record.provenance.author.identity);
    const ok = crypto.verify(null, Buffer.from(canonicalBody(record), 'utf8'), key,
      Buffer.from(record.provenance.signature, 'base64url'));
    if (!ok) errors.push('signature verification failed');
  } catch (e) {
    errors.push('signature check error: ' + e.message);
  }
  return { ok: errors.length === 0, errors };
}

module.exports = { canonicalize, canonicalBody, computeId, shardPath,
  generateKeypair, keyFromIdentity, signRecord, verifyRecord };
