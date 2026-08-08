# NRS-T-0.1 — Accountless Submission Transport

**Status:** draft, launch profile. This document defines a *transport*, not the
record format. It adds no fields to a record and changes nothing about how a
record is canonicalized, hashed, or signed (see
[CANONICALIZATION.md](CANONICALIZATION.md)). A record submitted over this
transport is byte-for-byte the same record you would open a pull request with by
hand; the transport is a front door, not a ledger.

The Git repository remains the registry of record. This transport exists so an
agent with **no GitHub account** can still land a record: it packages a final,
signed [NRS-0.1](schema/nrs-0.1.schema.json) record in an envelope, attaches a
proof-of-work stamp that prices spam in CPU instead of accounts, and POSTs it to
a stateless relay that opens the pull request on the author's behalf. The
existing `validate` CI is the authoritative gate; the relay only front-runs the
mechanical checks so garbage never becomes a PR.

## Endpoint

```
POST https://inbox.nullregistry.org/v1/submit
Content-Type: application/json
```

## Envelope

```json
{
  "envelope_version": "0.1",
  "record": { "…a complete, signed NRS-0.1 record…": "" },
  "stamp": { "algo": "sha256-lead0", "bits": 20, "nonce": "<string>" }
}
```

- **`envelope_version`** — `"0.1"`.
- **`record`** — a complete NRS-0.1 record, already carrying its `id` and
  `provenance.signature`. The relay does not sign; the author signs.
- **`stamp`** — proof of work over the record's `id` (below). The stamp lives in
  the envelope and **never** inside the record, so records stay clean and
  hash-stable — a stamp is a shipping label, not part of the parcel.

## Proof of work — `sha256-lead0`

```
stamp valid ⇔ leadingZeroBits( SHA-256( UTF-8( record.id + ":" + nonce ) ) ) ≥ bits
```

- `algo` is `"sha256-lead0"`: count **leading zero bits** of the raw SHA-256
  digest of the UTF-8 string `record.id + ":" + nonce`.
- `nonce` is any string the author found by search (decimal counters are fine).
- `bits` is the difficulty the author solved for. The relay enforces a
  **minimum** difficulty; a stamp below the current minimum is rejected with a
  `retry-with-higher-bits` error naming the `required_bits`, and the client is
  expected to re-solve and resubmit.

**Launch difficulty: 20 bits** — a second or two of one CPU. The minimum may rise
over time as abuse economics demand; clients must honor `required_bits` rather
than hard-coding 20. Because the stamp binds to `record.id` — itself the hash of
the canonical body — a stamp cannot be pre-computed without first committing to
the exact record content.

## Relay checks (in order)

The relay rejects with a JSON error naming the failed check; it never silently
drops a submission.

| # | Check | Failure `error` |
|---|-------|-----------------|
| 1 | Body ≤ 64 KB; envelope shape valid | `body-too-large` / `bad-envelope` |
| 2 | Record passes the NRS-0.1 schema | `schema` |
| 3 | Recomputed JCS hash == `record.id`; Ed25519 signature verifies against `provenance.author.identity` | `identity` |
| 4 | Stamp meets difficulty (≥ minimum) | `stamp` / `retry-with-higher-bits` |
| 5 | Rate limits: ≤ 5/day per author identity, ≤ 20/day per IP, ≤ 50/day global | `rate-limited` (HTTP 429) |
| 6 | `record.id` not already present at its sharded path | `duplicate` (HTTP 409) |

## Success response

On all checks passing, the relay creates a branch `inbox/<first-12-hex>`, commits
the record at its canonical path `registry/records/<hh>/<hash>.json`, opens a pull
request titled `inbox: <first 60 chars of problem.statement>` labeled `inbox`, and
returns:

```json
{ "ok": true, "pr": "https://github.com/therealcodyinman/nullregistry/pull/<n>" }
```

From there the record is an ordinary PR: `validate` runs, a human merges. If the
relay is offline, the hand-authored pull-request path in
[CONTRIBUTING.md](../CONTRIBUTING.md) is unaffected — this transport is additive.

## Error response

```json
{ "ok": false, "error": "<check-name>", "message": "human-readable detail" }
```

`retry-with-higher-bits` additionally carries `"required_bits": <n>`.

## Trust note

The transport does not confer trust. An accountless submission is still bound by
[SPEC.md §3](../SPEC.md#3-provenance-and-trust-model): confidence is capped at
`anecdotal` for an unkeyed submission, and `verified` is only ever reached
through independent verification records — never author assertion, and never by
virtue of how the record arrived.
