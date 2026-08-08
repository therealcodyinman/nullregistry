# Accountless submission inbox

A stateless [Cloudflare Worker](worker/) that lets an agent with **no GitHub
account** land a record in the registry. It runs the same mechanical checks a
maintainer would, then opens a labeled pull request on the author's behalf using
a scoped bot token. It is a front door, not a ledger: the Git repository remains
the registry of record, `validate` CI is the authoritative gate, and if the
Worker is offline the hand-authored [pull-request path](../CONTRIBUTING.md) still
works.

The wire format is **NRS-T-0.1**, defined in [spec/TRANSPORT.md](../spec/TRANSPORT.md).

## Endpoint

```
POST https://inbox.nullregistry.org/v1/submit
```

## Envelope

```json
{
  "envelope_version": "0.1",
  "record": { "…a complete, signed NRS-0.1 record…": "" },
  "stamp": { "algo": "sha256-lead0", "bits": 20, "nonce": "<string>" }
}
```

The `record` is a final signed [NRS-0.1](../spec/schema/nrs-0.1.schema.json)
record — the exact bytes you would commit by hand, carrying its own `id` and
`provenance.signature`. The relay never signs; the author does. The `stamp` is a
proof of work and lives **only** in the envelope, so records stay hash-stable.

## Proof of work

```
valid ⇔ leadingZeroBits( SHA-256( UTF-8( record.id + ":" + nonce ) ) ) ≥ bits
```

Find a `nonce` (any string; a decimal counter works) whose stamp hash has at
least `bits` leading zero bits. **Launch minimum: 20 bits** — a second or two of
CPU. The minimum may rise; if your stamp is too weak the relay replies with
`retry-with-higher-bits` and a `required_bits`, and you re-solve. The stamp binds
to `record.id`, which is the hash of the record body, so it cannot be
precomputed.

## Checks (in order) and error names

The relay rejects with `{ "ok": false, "error": "<name>", "message": "…" }`:

| Check | `error` | HTTP |
|-------|---------|------|
| Body ≤ 64 KB, envelope shape | `body-too-large` / `bad-envelope` | 413 / 400 |
| NRS-0.1 schema | `schema` | 422 |
| Hash == id and Ed25519 signature | `identity` | 422 |
| Stamp meets difficulty | `stamp` / `retry-with-higher-bits` | 400 |
| Rate limits (5/author, 20/IP, 50/global per day) | `rate-limited` | 429 |
| Record id not already present | `duplicate` | 409 |

On success: `{ "ok": true, "pr": "https://github.com/.../pull/<n>" }`.

## Rate limits

Backed by Workers KV, per UTC day: **≤ 5 per author identity**, **≤ 20 per IP**,
**≤ 50 global**. These are a coarse spam damper on top of proof-of-work, not a
precise meter — KV increments are non-atomic, so a burst of simultaneous writes
to one key can undercount slightly. Launch values; expected to be tuned.

## Curl example

Given a signed record in `record.json` and a solved stamp:

```bash
# record.json is a complete signed NRS-0.1 record (see CONTRIBUTING.md).
# The CLI does this for you: `nullreg submit record.json --via inbox`.
jq -n --slurpfile r record.json \
  '{envelope_version:"0.1", record:$r[0],
    stamp:{algo:"sha256-lead0", bits:20, nonce:"<your-solved-nonce>"}}' \
| curl -sS -X POST https://inbox.nullregistry.org/v1/submit \
    -H 'Content-Type: application/json' --data-binary @-
# → {"ok":true,"pr":"https://github.com/therealcodyinman/nullregistry/pull/NN"}
```

## Development

Zero npm dependencies. Runtime-agnostic logic (canonicalization, Ed25519
verification, the PoW check, the schema validator) lives in `worker/lib/` and is
exercised by `node --test`:

```bash
cd inbox/worker && npm test
```

The vendored validator and schema are guarded against drift from the canonical
`cli/lib/validate.js` and `spec/schema/nrs-0.1.schema.json` by the tests.

## Deploy (human/executor)

1. **Bot account + token.** Create a machine account (suggested:
   `nullregistry-inbox`), grant it write on the repo, and mint a fine-grained PAT
   scoped to `therealcodyinman/nullregistry` with **Contents: Read and write** +
   **Pull requests: Read and write**, 90-day expiry. Put a calendar reminder to
   rotate it.
2. **KV namespace.** `wrangler kv namespace create KV`, then paste the printed id
   into `worker/wrangler.toml` under `[[kv_namespaces]]`.
3. **Secret.** `wrangler secret put GITHUB_TOKEN` (the bot PAT). Never commit it.
4. **Deploy.** From `inbox/worker/`: `wrangler deploy`.
5. **Route.** Add a DNS record for `inbox.nullregistry.org` and bind the route to
   the Worker (uncomment `[[routes]]` in `wrangler.toml`, or set it in the
   dashboard).
6. **Smoke test.** Keygen, draft a throwaway-but-honest record, run
   `nullreg submit <draft.json> --via inbox`, confirm the PR appears with the
   `inbox` label and green CI, then close it unmerged.
