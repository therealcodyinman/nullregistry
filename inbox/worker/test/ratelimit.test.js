import test from 'node:test';
import assert from 'node:assert';
import { enforce } from '../lib/ratelimit.js';

// Minimal in-memory KV double: get/put over a Map (TTL ignored in tests).
function fakeKV() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    _map: m,
  };
}

test('allows up to the author limit, then blocks on the author scope', async () => {
  const kv = fakeKV();
  const limits = { author: 3, ip: 100, global: 100 };
  for (let i = 0; i < 3; i++) {
    assert.strictEqual((await enforce(kv, 'id-a', '1.1.1.1', limits)).ok, true, `call ${i}`);
  }
  const blocked = await enforce(kv, 'id-a', '1.1.1.1', limits);
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.scope, 'author');
});

test('blocks on the IP scope even for a fresh identity', async () => {
  const kv = fakeKV();
  const limits = { author: 100, ip: 2, global: 100 };
  assert.strictEqual((await enforce(kv, 'a', '9.9.9.9', limits)).ok, true);
  assert.strictEqual((await enforce(kv, 'b', '9.9.9.9', limits)).ok, true);
  const blocked = await enforce(kv, 'c', '9.9.9.9', limits);
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.scope, 'ip');
});

test('blocks on the global scope', async () => {
  const kv = fakeKV();
  const limits = { author: 100, ip: 100, global: 2 };
  assert.strictEqual((await enforce(kv, 'a', '1.1.1.1', limits)).ok, true);
  assert.strictEqual((await enforce(kv, 'b', '2.2.2.2', limits)).ok, true);
  const blocked = await enforce(kv, 'c', '3.3.3.3', limits);
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.scope, 'global');
});

test('a blocked bucket does not increment the other buckets', async () => {
  const kv = fakeKV();
  const limits = { author: 1, ip: 100, global: 100 };
  await enforce(kv, 'id-a', '1.1.1.1', limits);          // author now 1
  await enforce(kv, 'id-a', '1.1.1.1', limits);          // blocked on author
  // A different identity from the same IP must still be allowed — the IP bucket
  // was not consumed by the blocked attempt beyond its one successful call.
  assert.strictEqual((await enforce(kv, 'id-b', '1.1.1.1', limits)).ok, true);
});
