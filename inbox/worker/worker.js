// Null Registry accountless submission relay (NRS-T-0.1).
//
// Stateless front door: an agent with no GitHub account POSTs a signed NRS-0.1
// record wrapped in an envelope with a proof-of-work stamp; this Worker runs the
// mechanical checks and, on pass, opens a labeled pull request via a bot PAT. It
// holds no ledger — the Git repo remains the registry of record, and the
// existing `validate` CI is the authoritative gate. KV is used only for rate
// limiting. See spec/TRANSPORT.md.

import { validate } from './lib/validate.js';
import { NRS_SCHEMA } from './lib/schema.js';
import { computeId, verifyRecord, shardPath } from './lib/core.js';
import { checkStamp } from './lib/pow.js';
import { enforce, LIMITS } from './lib/ratelimit.js';
import { GitHub } from './lib/github.js';

const MAX_BODY = 64 * 1024; // 64 KB
const MIN_BITS = 20; // launch difficulty; may rise (clients honor required_bits)
const DEFAULT_REPO = 'therealcodyinman/nullregistry';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function err(error, message, status, extra = {}) {
  return json({ ok: false, error, message, ...extra }, status);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/v1/health') {
      return json({ ok: true, service: 'nullregistry-inbox', min_bits: MIN_BITS });
    }
    if (url.pathname !== '/v1/submit') {
      return err('not-found', 'Unknown path; POST to /v1/submit', 404);
    }
    if (request.method !== 'POST') {
      return err('method-not-allowed', 'Use POST', 405);
    }

    // 1. Size cap + envelope shape.
    const raw = await request.arrayBuffer();
    if (raw.byteLength > MAX_BODY) {
      return err('body-too-large', `Body exceeds ${MAX_BODY} bytes`, 413);
    }
    let envelope;
    try {
      envelope = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return err('bad-envelope', 'Body is not valid JSON', 400);
    }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      return err('bad-envelope', 'Envelope must be a JSON object', 400);
    }
    if (envelope.envelope_version !== '0.1') {
      return err('bad-envelope', 'Unsupported envelope_version (expected "0.1")', 400);
    }
    const record = envelope.record;
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return err('bad-envelope', 'Envelope.record must be a JSON object', 400);
    }

    // 2. Record passes the NRS-0.1 schema.
    const schemaErrors = validate(NRS_SCHEMA, record);
    if (schemaErrors.length) {
      return err('schema', 'Record failed schema validation', 422, { details: schemaErrors });
    }

    // 3. Recomputed hash == id; Ed25519 signature verifies.
    const idCheck = await verifyRecord(record);
    if (!idCheck.ok) {
      return err('identity', 'Record id/signature check failed', 422, { details: idCheck.errors });
    }

    // 4. Proof-of-work stamp meets the minimum difficulty.
    const stamp = await checkStamp(record.id, envelope.stamp, MIN_BITS);
    if (!stamp.ok) {
      if (stamp.error === 'retry-with-higher-bits') {
        return err('retry-with-higher-bits',
          `Stamp below current minimum; resolve at ${stamp.required_bits} bits`,
          400, { required_bits: stamp.required_bits });
      }
      return err('stamp', stamp.message, 400);
    }

    // 5. Rate limits (author identity / IP / global) via KV.
    if (!env.KV) {
      return err('server', 'Rate-limit store unavailable', 500);
    }
    const identity = record.provenance.author.identity;
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rl = await enforce(env.KV, identity, ip, LIMITS);
    if (!rl.ok) {
      return err('rate-limited', `Daily ${rl.scope} submission limit reached`, 429, { scope: rl.scope });
    }

    // 6..end: GitHub — duplicate check, branch, commit, PR, label.
    const token = env.GITHUB_TOKEN;
    if (!token) {
      return err('server', 'Relay is missing its GitHub credential', 500);
    }
    const repoSlug = env.GITHUB_REPO || DEFAULT_REPO;
    const gh = new GitHub(token, repoSlug);
    const rel = 'registry/records/' + shardPath(record.id);

    try {
      const base = await gh.defaultBranch();

      // 6. Record id not already present at its sharded path.
      if (await gh.contentExists(rel, base)) {
        return err('duplicate', 'A record with this id already exists', 409, {
          id: record.id, path: rel,
        });
      }

      const hex = record.id.split(':')[2];
      const branch = 'inbox/' + hex.slice(0, 12);
      const sha = await gh.refSha(base);
      try {
        await gh.createBranch(branch, sha);
      } catch (e) {
        if (e.status === 422) {
          return err('duplicate', 'A submission for this record is already in flight', 409, {
            id: record.id, branch,
          });
        }
        throw e;
      }

      const statement = record.problem.statement;
      const fileText = JSON.stringify(record, null, 2) + '\n';
      const commitMsg = 'inbox: ' + statement.slice(0, 60);
      await gh.putFile(rel, branch, commitMsg, fileText);

      const title = 'inbox: ' + statement.slice(0, 60);
      const body = [
        'Submitted via the **accountless inbox** (NRS-T-0.1) — no GitHub account was used.',
        '',
        '- **id:** `' + record.id + '`',
        '- **author identity:** `' + identity + '`',
        '- **confidence:** `' + record.confidence.level + '`',
        '- **proof-of-work:** `sha256-lead0`, ' + stamp.bits + ' leading zero bits',
        '',
        'The `validate` CI is the authoritative gate — schema, content-hash, signature,',
        'filename, and add-only immutability are all checked here like any other PR. A',
        'maintainer merges after review.',
        '',
        'Transport spec: https://github.com/' + repoSlug + '/blob/' + base + '/spec/TRANSPORT.md',
      ].join('\n');
      const pr = await gh.createPR(title, branch, base, body);

      try {
        await gh.addLabels(pr.number, ['inbox']);
      } catch {
        // Label is best-effort; the PR (and its CI) is what matters.
      }

      return json({ ok: true, pr: pr.html_url });
    } catch (e) {
      return err('github', 'Failed to open pull request: ' + e.message, 502);
    }
  },
};
