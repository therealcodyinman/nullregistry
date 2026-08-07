// Per-day rate limiting backed by Workers KV. Three independent buckets:
//   author identity ≤ 5/day, IP ≤ 20/day, global ≤ 50/day.
//
// KV has no atomic increment, so this is read-then-write and can undercount
// under a burst of truly-simultaneous writes to the same key. That is an
// accepted launch trade-off (documented in inbox/README.md and DECISIONS.md):
// the buckets are a coarse spam damper on top of proof-of-work, not a billing
// meter. `kv` is any object with async get(key)/put(key,val,opts) — the real
// binding in the Worker, a Map-backed fake in tests.

const DAY_TTL = 2 * 24 * 60 * 60; // keep a day's counters ~2 days, then expire

export const LIMITS = { author: 5, ip: 20, global: 50 };

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

async function count(kv, key) {
  const v = await kv.get(key);
  return v ? parseInt(v, 10) || 0 : 0;
}

// Check all buckets; if all under limit, increment all and allow. Returns
// { ok: true } or { ok: false, scope: 'author'|'ip'|'global' }.
export async function enforce(kv, identity, ip, limits = LIMITS) {
  const day = today();
  const buckets = [
    { scope: 'author', key: `rl:author:${identity}:${day}`, limit: limits.author },
    { scope: 'ip', key: `rl:ip:${ip}:${day}`, limit: limits.ip },
    { scope: 'global', key: `rl:global:${day}`, limit: limits.global },
  ];
  const counts = [];
  for (const b of buckets) {
    const c = await count(kv, b.key);
    if (c >= b.limit) return { ok: false, scope: b.scope };
    counts.push(c);
  }
  for (let i = 0; i < buckets.length; i++) {
    await kv.put(buckets[i].key, String(counts[i] + 1), { expirationTtl: DAY_TTL });
  }
  return { ok: true };
}
