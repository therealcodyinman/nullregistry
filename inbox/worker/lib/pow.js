// Proof-of-work stamp check for NRS-T-0.1 ("sha256-lead0").
//
//   valid ⇔ leadingZeroBits( SHA-256( UTF-8( id + ":" + nonce ) ) ) ≥ bits
//
// Runtime-agnostic (WebCrypto + TextEncoder), so `node --test` exercises the
// exact code the Worker runs. See spec/TRANSPORT.md.

// Count leading zero bits of a big-endian byte array.
export function leadingZeroBits(bytes) {
  let count = 0;
  for (const b of bytes) {
    if (b === 0) { count += 8; continue; }
    // b is 1..255 here; Math.clz32 counts within 32 bits, so subtract the 24
    // high bits that are always zero for a single byte → 0..7 leading zeros.
    count += Math.clz32(b) - 24;
    break;
  }
  return count;
}

// Number of leading zero bits the (id, nonce) pair actually achieves.
export async function stampBits(id, nonce) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id + ':' + nonce));
  return leadingZeroBits(new Uint8Array(digest));
}

// Validate a stamp envelope against the record id and the relay's minimum
// difficulty. Returns one of:
//   { ok: true, bits }
//   { ok: false, error: 'stamp', message }              — malformed / not solved
//   { ok: false, error: 'retry-with-higher-bits', required_bits }
export async function checkStamp(id, stamp, minBits) {
  if (!stamp || typeof stamp !== 'object') {
    return { ok: false, error: 'stamp', message: 'missing stamp' };
  }
  if (stamp.algo !== 'sha256-lead0') {
    return { ok: false, error: 'stamp', message: `unsupported stamp algo: ${stamp.algo}` };
  }
  if (!Number.isInteger(stamp.bits) || stamp.bits < 1) {
    return { ok: false, error: 'stamp', message: 'stamp.bits must be a positive integer' };
  }
  if (typeof stamp.nonce !== 'string' || stamp.nonce.length === 0) {
    return { ok: false, error: 'stamp', message: 'stamp.nonce must be a non-empty string' };
  }
  if (stamp.bits < minBits) {
    return { ok: false, error: 'retry-with-higher-bits', required_bits: minBits };
  }
  const achieved = await stampBits(id, stamp.nonce);
  // Enforce the relay minimum against the *actual* work, so a claimed high
  // `bits` with a weak nonce cannot slip through.
  if (achieved < minBits) {
    return { ok: false, error: 'retry-with-higher-bits', required_bits: minBits };
  }
  if (achieved < stamp.bits) {
    return { ok: false, error: 'stamp', message: `nonce yields ${achieved} leading zero bits, below claimed ${stamp.bits}` };
  }
  return { ok: true, bits: achieved };
}
