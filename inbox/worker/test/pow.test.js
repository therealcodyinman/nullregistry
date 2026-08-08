import test from 'node:test';
import assert from 'node:assert';
import { leadingZeroBits, stampBits, checkStamp } from '../lib/pow.js';
import { mineStamp } from './fixtures.js';

test('leadingZeroBits: byte-boundary vectors', () => {
  assert.strictEqual(leadingZeroBits(new Uint8Array([0xff])), 0);
  assert.strictEqual(leadingZeroBits(new Uint8Array([0x80])), 0);
  assert.strictEqual(leadingZeroBits(new Uint8Array([0x40])), 1);
  assert.strictEqual(leadingZeroBits(new Uint8Array([0x01])), 7);
  assert.strictEqual(leadingZeroBits(new Uint8Array([0x00, 0xff])), 8);
  assert.strictEqual(leadingZeroBits(new Uint8Array([0x00, 0x00, 0x08])), 20);
  assert.strictEqual(leadingZeroBits(new Uint8Array([0x00, 0x00])), 16);
});

test('stampBits matches a mined nonce', async () => {
  const id = 'nr:sha256:' + 'a'.repeat(64);
  const s = mineStamp(id, 12);
  const achieved = await stampBits(id, s.nonce);
  assert.ok(achieved >= 12, `mined nonce should meet 12 bits, got ${achieved}`);
});

test('checkStamp: accepts a valid stamp at the minimum', async () => {
  const id = 'nr:sha256:' + 'b'.repeat(64);
  const s = mineStamp(id, 12);
  const res = await checkStamp(id, s, 12);
  assert.strictEqual(res.ok, true);
  assert.ok(res.bits >= 12);
});

test('checkStamp: rejects claimed bits below the minimum with retry-with-higher-bits', async () => {
  const id = 'nr:sha256:' + 'c'.repeat(64);
  const s = mineStamp(id, 8);
  const res = await checkStamp(id, s, 20);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, 'retry-with-higher-bits');
  assert.strictEqual(res.required_bits, 20);
});

test('checkStamp: rejects a nonce that does not achieve the claimed bits', async () => {
  const id = 'nr:sha256:' + 'd'.repeat(64);
  // Claim 20 bits but supply a nonce mined only to ~4 — actual work is below
  // the minimum, so it must be told to retry higher, never accepted.
  const weak = mineStamp(id, 4);
  const res = await checkStamp(id, { algo: 'sha256-lead0', bits: 20, nonce: weak.nonce }, 20);
  assert.strictEqual(res.ok, false);
  assert.ok(res.error === 'retry-with-higher-bits' || res.error === 'stamp');
});

test('checkStamp: rejects malformed stamps', async () => {
  const id = 'nr:sha256:' + 'e'.repeat(64);
  assert.strictEqual((await checkStamp(id, null, 20)).error, 'stamp');
  assert.strictEqual((await checkStamp(id, { algo: 'scrypt', bits: 20, nonce: '1' }, 20)).error, 'stamp');
  assert.strictEqual((await checkStamp(id, { algo: 'sha256-lead0', bits: 0, nonce: '1' }, 20)).error, 'stamp');
  assert.strictEqual((await checkStamp(id, { algo: 'sha256-lead0', bits: 20, nonce: '' }, 20)).error, 'stamp');
});
