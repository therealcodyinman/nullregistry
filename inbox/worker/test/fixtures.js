// Test fixtures: build a real, signed NRS-0.1 record and mine a PoW stamp.
// Signing/hashing here uses node:crypto for speed; the Worker code under test
// verifies with WebCrypto, so a pass proves the two agree.
import crypto from 'node:crypto';
import { canonicalBody } from '../lib/core.js';

export function makeSignedRecord(overrides = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const identity = 'ed25519:' + publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
  const record = {
    nrs_version: '0.1',
    created: '2026-08-07T12:00:00Z',
    problem: {
      statement: 'A sufficiently long problem statement used for relay tests.',
      fingerprint: { domain: 'software', tags: ['test', 'inbox'] },
    },
    approach: { summary: 'Tried the approach that does not work here.' },
    failure: {
      mode: 'incorrect_result',
      point: 'It broke right at this identifiable step.',
      evidence: 'Observed the wrong output in the test harness.',
    },
    environment: { description: 'test environment' },
    transferability: { scope: 'unknown', notes: 'test only' },
    confidence: { level: 'anecdotal' },
    provenance: { author: { type: 'agent', identity } },
    ...overrides,
  };
  const hex = crypto.createHash('sha256').update(canonicalBody(record), 'utf8').digest('hex');
  record.id = 'nr:sha256:' + hex;
  record.provenance.signature =
    crypto.sign(null, Buffer.from(canonicalBody(record), 'utf8'), privateKey).toString('base64url');
  return { record, privateKey, identity };
}

function leadingZeroBits(bytes) {
  let count = 0;
  for (const b of bytes) {
    if (b === 0) { count += 8; continue; }
    count += Math.clz32(b) - 24;
    break;
  }
  return count;
}

export function mineStamp(id, bits) {
  let n = 0;
  for (;;) {
    const h = crypto.createHash('sha256').update(id + ':' + n, 'utf8').digest();
    if (leadingZeroBits(h) >= bits) return { algo: 'sha256-lead0', bits, nonce: String(n) };
    n++;
  }
}
