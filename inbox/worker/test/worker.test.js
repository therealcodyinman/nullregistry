import test from 'node:test';
import assert from 'node:assert';
import worker from '../worker.js';
import { makeSignedRecord, mineStamp } from './fixtures.js';

const MIN_BITS = 20;

// Mine one valid record+stamp at the launch difficulty, reused across tests.
const { record } = makeSignedRecord();
const stamp = mineStamp(record.id, MIN_BITS);

function fakeKV() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    _map: m,
  };
}

function post(envelope, headers = {}) {
  return new Request('https://inbox.nullregistry.org/v1/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7', ...headers },
    body: typeof envelope === 'string' ? envelope : JSON.stringify(envelope),
  });
}

function baseEnv() {
  return { KV: fakeKV(), GITHUB_TOKEN: 'test-token', GITHUB_REPO: 'therealcodyinman/nullregistry' };
}

// Install a fetch stub emulating the GitHub REST calls the relay makes.
// `opts.exists` controls whether the record already exists (duplicate path).
function stubGitHub({ exists = false } = {}) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const u = new URL(url);
    calls.push(`${method} ${u.pathname}`);
    const reply = (status, data) =>
      new Response(data == null ? '' : JSON.stringify(data), {
        status, headers: { 'Content-Type': 'application/json' },
      });

    if (method === 'GET' && /\/repos\/[^/]+\/[^/]+$/.test(u.pathname)) {
      return reply(200, { default_branch: 'main' });
    }
    if (method === 'GET' && u.pathname.includes('/contents/')) {
      return exists ? reply(200, { name: 'exists' }) : reply(404, { message: 'Not Found' });
    }
    if (method === 'GET' && u.pathname.includes('/git/ref/heads/')) {
      return reply(200, { object: { sha: 'a'.repeat(40) } });
    }
    if (method === 'POST' && u.pathname.endsWith('/git/refs')) {
      return reply(201, { ref: 'refs/heads/inbox' });
    }
    if (method === 'PUT' && u.pathname.includes('/contents/')) {
      return reply(201, { commit: { sha: 'b'.repeat(40) } });
    }
    if (method === 'POST' && u.pathname.endsWith('/pulls')) {
      return reply(201, { number: 42, html_url: 'https://github.com/therealcodyinman/nullregistry/pull/42' });
    }
    if (method === 'POST' && u.pathname.endsWith('/labels')) {
      return reply(200, [{ name: 'inbox' }]);
    }
    return reply(500, { message: 'unexpected call: ' + method + ' ' + u.pathname });
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

test('rejects non-POST and unknown paths', async () => {
  const get = await worker.fetch(new Request('https://inbox.nullregistry.org/v1/submit'), baseEnv());
  assert.strictEqual(get.status, 405);
  const nf = await worker.fetch(new Request('https://inbox.nullregistry.org/nope', { method: 'POST' }), baseEnv());
  assert.strictEqual(nf.status, 404);
});

test('health endpoint reports the minimum difficulty', async () => {
  const res = await worker.fetch(new Request('https://inbox.nullregistry.org/v1/health'), baseEnv());
  const body = await res.json();
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.min_bits, MIN_BITS);
});

test('bad-envelope on non-JSON and wrong version', async () => {
  let res = await worker.fetch(post('{not json'), baseEnv());
  assert.strictEqual(res.status, 400);
  assert.strictEqual((await res.json()).error, 'bad-envelope');

  res = await worker.fetch(post({ envelope_version: '9.9', record, stamp }), baseEnv());
  assert.strictEqual((await res.json()).error, 'bad-envelope');
});

test('body-too-large is rejected before parsing', async () => {
  const huge = 'x'.repeat(64 * 1024 + 1);
  const res = await worker.fetch(post(huge), baseEnv());
  assert.strictEqual(res.status, 413);
  assert.strictEqual((await res.json()).error, 'body-too-large');
});

test('schema failure names the schema check', async () => {
  const bad = JSON.parse(JSON.stringify(record));
  delete bad.transferability;
  const res = await worker.fetch(post({ envelope_version: '0.1', record: bad, stamp }), baseEnv());
  assert.strictEqual(res.status, 422);
  assert.strictEqual((await res.json()).error, 'schema');
});

test('tampered record fails the identity check', async () => {
  const tampered = JSON.parse(JSON.stringify(record));
  tampered.approach.summary = 'tampered after signing so the signature is invalid';
  const res = await worker.fetch(post({ envelope_version: '0.1', record: tampered, stamp }), baseEnv());
  assert.strictEqual(res.status, 422);
  assert.strictEqual((await res.json()).error, 'identity');
});

test('a stamp below the minimum yields retry-with-higher-bits', async () => {
  const weak = mineStamp(record.id, 8);
  const res = await worker.fetch(post({ envelope_version: '0.1', record, stamp: weak }), baseEnv());
  assert.strictEqual(res.status, 400);
  const body = await res.json();
  assert.strictEqual(body.error, 'retry-with-higher-bits');
  assert.strictEqual(body.required_bits, MIN_BITS);
});

test('rate limit returns 429 before touching GitHub', async () => {
  const env = baseEnv();
  const day = new Date().toISOString().slice(0, 10);
  env.KV._map.set(`rl:author:${record.provenance.author.identity}:${day}`, '5');
  const res = await worker.fetch(post({ envelope_version: '0.1', record, stamp }), env);
  assert.strictEqual(res.status, 429);
  const body = await res.json();
  assert.strictEqual(body.error, 'rate-limited');
  assert.strictEqual(body.scope, 'author');
});

test('happy path opens a labeled PR and returns its url', async () => {
  const gh = stubGitHub();
  try {
    const res = await worker.fetch(post({ envelope_version: '0.1', record, stamp }), baseEnv());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.match(body.pr, /\/pull\/42$/);
    // The label call must have happened against PR #42.
    assert.ok(gh.calls.some((c) => c === 'POST /repos/therealcodyinman/nullregistry/issues/42/labels'));
    assert.ok(gh.calls.some((c) => c.startsWith('POST') && c.endsWith('/pulls')));
  } finally {
    gh.restore();
  }
});

test('duplicate record returns 409 without opening a PR', async () => {
  const gh = stubGitHub({ exists: true });
  try {
    const res = await worker.fetch(post({ envelope_version: '0.1', record, stamp }), baseEnv());
    assert.strictEqual(res.status, 409);
    assert.strictEqual((await res.json()).error, 'duplicate');
    assert.ok(!gh.calls.some((c) => c.endsWith('/pulls')), 'must not open a PR for a duplicate');
  } finally {
    gh.restore();
  }
});
