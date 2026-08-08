'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const merkle = require('../lib/merkle.js');

test('leaf hash uses the 0x00 domain prefix (RFC 6962)', () => {
  const expected = crypto.createHash('sha256')
    .update(Buffer.concat([Buffer.from([0x00]), Buffer.from('a', 'utf8')])).digest('hex');
  // A one-leaf tree's root is exactly the leaf hash.
  assert.strictEqual(merkle.computeRoot(['a']), expected);
  assert.strictEqual(merkle.leafHash('a').toString('hex'), expected);
});

test('fixed root vectors are stable (regression guard on the tree rule)', () => {
  assert.strictEqual(merkle.computeRoot(['a']),
    '022a6979e6dab7aa5ae4c3e5e45f7e977112a7e63593820dbec1ec738a24f93c');
  assert.strictEqual(merkle.computeRoot(['a', 'b', 'c']),
    '36642e73c2540ab121e3a6bf9545b0a24982cd830eb13d3cd19de3ce6c021ec1');
  assert.strictEqual(merkle.computeRoot(['a', 'b', 'c', 'd', 'e']),
    'fe14a5426fbd70c0fa73f52342afed0da0bd23c4838662ccf6b88a3070ead97b');
});

test('node hash uses the 0x01 domain prefix and differs from a bare concat', () => {
  const l = merkle.leafHash('a');
  const r = merkle.leafHash('b');
  const withPrefix = crypto.createHash('sha256')
    .update(Buffer.concat([Buffer.from([0x01]), l, r])).digest();
  const withoutPrefix = crypto.createHash('sha256').update(Buffer.concat([l, r])).digest();
  assert.deepStrictEqual(merkle.nodeHash(l, r), withPrefix);
  assert.notDeepStrictEqual(merkle.nodeHash(l, r), withoutPrefix);
});

test('inclusion proofs verify for every leaf across odd and even tree sizes', () => {
  for (let size = 1; size <= 33; size++) {
    const leaves = Array.from({ length: size }, (_, i) => 'nr:sha256:' + String(i).padStart(64, '0'));
    const root = merkle.computeRoot(leaves);
    for (let i = 0; i < size; i++) {
      const proof = merkle.inclusionProof(leaves, i);
      assert.ok(merkle.verifyInclusion(leaves[i], proof, root),
        `proof must verify for size ${size} index ${i}`);
    }
  }
});

test('a tampered sibling or wrong leaf fails verification', () => {
  const leaves = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const root = merkle.computeRoot(leaves);
  const proof = merkle.inclusionProof(leaves, 3);
  assert.ok(merkle.verifyInclusion('d', proof, root));
  // Wrong leaf.
  assert.ok(!merkle.verifyInclusion('x', proof, root));
  // Tampered sibling.
  const bad = JSON.parse(JSON.stringify(proof));
  bad[0].sibling = bad[0].sibling.replace(/^./, (c) => (c === 'a' ? 'b' : 'a'));
  assert.ok(!merkle.verifyInclusion('d', bad, root));
});

test('inclusionProof rejects an out-of-range index', () => {
  assert.throws(() => merkle.inclusionProof(['a', 'b'], 5));
});
