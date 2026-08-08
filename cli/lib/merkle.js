'use strict';
// Merkle tree for NRS-C-0.1 checkpoints (see spec/CHECKPOINT.md).
//
// RFC 6962-style domain separation — leaf hash = SHA-256(0x00 || leaf),
// interior node = SHA-256(0x01 || left || right) — combined level-by-level with
// the "odd node promotes" rule: when a level has an odd count, the last node is
// carried up unchanged rather than duplicated. Leaves are the UTF-8 bytes of a
// record/verification id string, pre-sorted by the caller.
const crypto = require('node:crypto');

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

function sha256(...parts) {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
}

function leafHash(leaf) {
  return sha256(LEAF_PREFIX, Buffer.from(leaf, 'utf8'));
}

function nodeHash(left, right) {
  return sha256(NODE_PREFIX, left, right);
}

// One combining pass: pairs [0,1],[2,3],…; a trailing unpaired node promotes.
function combine(level) {
  const next = [];
  for (let i = 0; i < level.length; i += 2) {
    next.push(i + 1 < level.length ? nodeHash(level[i], level[i + 1]) : level[i]);
  }
  return next;
}

// Root as lowercase hex. Empty tree = SHA-256 of the empty string (RFC 6962).
function computeRoot(leaves) {
  if (leaves.length === 0) return sha256(Buffer.alloc(0)).toString('hex');
  let level = leaves.map(leafHash);
  while (level.length > 1) level = combine(level);
  return level[0].toString('hex');
}

// Inclusion proof for the leaf at `index`: the sibling hashes needed to rebuild
// the root, bottom-up. Each step is { sibling: <hex>, dir: 'left' | 'right' }
// where dir is the sibling's side. Promoted (unpaired) levels contribute no step.
function inclusionProof(leaves, index) {
  if (index < 0 || index >= leaves.length) throw new Error('index out of range');
  let level = leaves.map(leafHash);
  let idx = index;
  const path = [];
  while (level.length > 1) {
    if (idx % 2 === 1) {
      path.push({ sibling: level[idx - 1].toString('hex'), dir: 'left' });
    } else if (idx + 1 < level.length) {
      path.push({ sibling: level[idx + 1].toString('hex'), dir: 'right' });
    } // else: promoted this level, no sibling
    idx = Math.floor(idx / 2);
    level = combine(level);
  }
  return path;
}

// Recompute the root from a leaf + its proof and compare to `rootHex`.
function verifyInclusion(leaf, path, rootHex) {
  let h = leafHash(leaf);
  for (const step of path) {
    const sib = Buffer.from(step.sibling, 'hex');
    h = step.dir === 'left' ? nodeHash(sib, h) : nodeHash(h, sib);
  }
  return h.toString('hex') === rootHex;
}

module.exports = { leafHash, nodeHash, computeRoot, inclusionProof, verifyInclusion };
