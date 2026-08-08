// NRS-0.1 canonicalization, hashing, and Ed25519 verification for the relay.
//
// Ported from cli/lib/core.js, which uses node:crypto. This copy is
// runtime-agnostic: it uses only the WebCrypto Subtle API (crypto.subtle) and
// TextEncoder/atob, all of which exist in both Cloudflare Workers and Node ≥ 20,
// so the exact same functions are exercised by `node --test`. All hashing and
// verification is therefore async. The canonicalization is byte-identical to the
// CLI's — interop depends on it (see spec/CANONICALIZATION.md).

// --- Minimal RFC 8785 (JCS) canonicalization -------------------------------
// Sufficient for NRS records: objects, arrays, strings, numbers (integers),
// booleans, null. Pure — no crypto, no runtime globals.
export function canonicalize(value) {
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
export function canonicalBody(record) {
  const clone = JSON.parse(JSON.stringify(record));
  delete clone.id;
  if (clone.provenance) delete clone.provenance.signature;
  return canonicalize(clone);
}

// --- Byte/encoding helpers (no deps) ----------------------------------------
function bytesToHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Hex(str) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return bytesToHex(new Uint8Array(digest));
}

export async function hashCanonicalBody(record) {
  return sha256Hex(canonicalBody(record));
}

export async function computeId(record) {
  return 'nr:sha256:' + (await hashCanonicalBody(record));
}

export function shardPath(id) {
  const hex = id.split(':')[2];
  return hex.slice(0, 2) + '/' + hex + '.json';
}

// --- Ed25519 verification via WebCrypto -------------------------------------
// Identity is "ed25519:" + base64url(SPKI DER of the public key); signature is
// base64url of the raw 64-byte Ed25519 signature over the canonical body.
async function checkSignature(record) {
  const identity = record?.provenance?.author?.identity;
  if (typeof identity !== 'string' || !identity.startsWith('ed25519:')) {
    throw new Error('unsupported identity scheme');
  }
  const spki = b64urlToBytes(identity.slice('ed25519:'.length));
  const sig = b64urlToBytes(record.provenance.signature);
  const key = await crypto.subtle.importKey('spki', spki, { name: 'Ed25519' }, false, ['verify']);
  const data = new TextEncoder().encode(canonicalBody(record));
  return crypto.subtle.verify({ name: 'Ed25519' }, key, sig, data);
}

// Recompute id and verify signature. Returns { ok, errors } like the CLI's
// verifyRecord so the relay can name exactly what failed.
export async function verifyRecord(record) {
  const errors = [];
  let expected;
  try {
    expected = await computeId(record);
    if (record.id !== expected) errors.push(`id mismatch: expected ${expected}`);
  } catch (e) {
    errors.push('id computation error: ' + e.message);
  }
  try {
    if (!(await checkSignature(record))) errors.push('signature verification failed');
  } catch (e) {
    errors.push('signature check error: ' + e.message);
  }
  return { ok: errors.length === 0, errors };
}
