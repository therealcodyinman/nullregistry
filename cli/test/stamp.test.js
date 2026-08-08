'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const core = require('../lib/core.js');

test('leadingZeroBits: byte-boundary vectors', () => {
  assert.strictEqual(core.leadingZeroBits(Buffer.from([0xff])), 0);
  assert.strictEqual(core.leadingZeroBits(Buffer.from([0x80])), 0);
  assert.strictEqual(core.leadingZeroBits(Buffer.from([0x40])), 1);
  assert.strictEqual(core.leadingZeroBits(Buffer.from([0x01])), 7);
  assert.strictEqual(core.leadingZeroBits(Buffer.from([0x00, 0xff])), 8);
  assert.strictEqual(core.leadingZeroBits(Buffer.from([0x00, 0x00, 0x08])), 20);
});

test('stampBits agrees with a direct SHA-256 computation', () => {
  const id = 'nr:sha256:' + 'a'.repeat(64);
  const nonce = '12345';
  const digest = crypto.createHash('sha256').update(id + ':' + nonce, 'utf8').digest();
  assert.strictEqual(core.stampBits(id, nonce), core.leadingZeroBits(digest));
});

test('computeStamp returns a nonce meeting the requested difficulty', () => {
  const id = 'nr:sha256:' + 'b'.repeat(64);
  const stamp = core.computeStamp(id, 12);
  assert.strictEqual(stamp.algo, 'sha256-lead0');
  assert.strictEqual(stamp.bits, 12);
  assert.strictEqual(typeof stamp.nonce, 'string');
  assert.ok(core.stampBits(id, stamp.nonce) >= 12, 'nonce must actually meet 12 bits');
});

test('computeStamp binds to the record id', () => {
  const id = 'nr:sha256:' + 'c'.repeat(64);
  const other = 'nr:sha256:' + 'd'.repeat(64);
  const stamp = core.computeStamp(id, 12);
  // Each id gets its own solution valid for that id...
  assert.ok(core.stampBits(id, stamp.nonce) >= 12);
  const otherStamp = core.computeStamp(other, 12);
  assert.ok(core.stampBits(other, otherStamp.nonce) >= 12);
  // ...and the stamp string is over `id + ":" + nonce`, so the hashed input
  // differs by construction when the id differs.
  const a = crypto.createHash('sha256').update(id + ':' + stamp.nonce, 'utf8').digest('hex');
  const b = crypto.createHash('sha256').update(other + ':' + stamp.nonce, 'utf8').digest('hex');
  assert.notStrictEqual(a, b);
});
