# NRS-TS-0.1 — Tombstones

**Status:** draft. This document defines how a hazardous *payload* is removed from
the registry without deleting the *claim*.

## Doctrine

The registry's founding rule is that records are immutable and are never deleted
— correction happens by supersession and refutation, in public, leaving an audit
trail ([SPEC.md §3](../SPEC.md)). Tombstones do not weaken that rule. They amend
it with one narrow principle:

> **Claims are never deleted; payloads that are hazards can be reduced to
> commitments.**

A tombstone removes the *body* of a record while preserving the *fact that the
record existed*, its `id`, and its place in the log. What was there is gone; that
something was there, and why it was removed, is permanent.

## Grounds — and what is never grounds

The only admissible grounds are the [SPEC.md §2](../SPEC.md#2-what-is-explicitly-out-of-scope-for-a-record)
exclusions — the material that should never have been published:

- **`secrets`** — leaked credentials, keys, tokens, or other secrets.
- **`personal_data`** — personal or otherwise private data about an individual.
- **`harm_enabling`** — content whose primary value is instructions for causing harm.

**Wrongness is never grounds.** A record that turns out to be mistaken,
overgeneralized, or refuted is not tombstoned — it is superseded or refuted by a
verification record, exactly as before. Tombstoning is reserved for payloads that
are hazardous to *carry*, never for claims that are merely *false*. Conflating the
two would hand anyone who dislikes a finding a delete button; the redaction path
is deliberately not that.

## Leaves are unaffected — checkpoints and proofs remain valid

This is the load-bearing property. In v2 ([spec/CHECKPOINT.md](CHECKPOINT.md)) the
Merkle **leaf is the record's `id` string**, not the file's bytes. A tombstone
**preserves the `id`** (and the filename, which equals the id's hash, and the
shard directory, which equals the id's prefix). Therefore:

- the sorted leaf set is unchanged,
- every published Merkle **root** is unchanged,
- every existing **inclusion proof** still verifies, and
- every **checkpoint** — past and future — remains consistent.

A tombstone is the one edit the transparency log can absorb without disturbing its
history, precisely because the log commits to ids, not bytes. `checkpoint.js`
treats a tombstoned id as an ordinary leaf (it reads `.id` from the file, which is
preserved); `verify-checkpoint.js` derives leaves from paths alone, so it never
even reads a tombstone's contents.

## The tombstone document

A tombstone replaces the body file at the record's existing path
(`registry/records/<hh>/<hash>.json` or `registry/verifications/<hh>/<hash>.json`),
keeping the filename and the original `id`.

```json
{
  "tombstone_version": "0.1",
  "id": "<original nr:/nrv: id>",
  "redacted": true,
  "grounds": "secrets|personal_data|harm_enabling",
  "statement": "<one-sentence public reason, no detail that re-exposes>",
  "original_sha256": "<hex sha256 of the removed file bytes>",
  "redacted_at": "<ISO 8601 UTC>",
  "signature": "<Ed25519 base64url over JCS body sans signature>",
  "key_id": "<checkpoint key identity from spec/CHECKPOINT_KEY.pub>"
}
```

- **`id`** — the exact `nr:`/`nrv:` id of the record being redacted, preserved so
  the leaf is unchanged. Its hash must equal the filename; CI enforces this.
- **`statement`** — a one-sentence public reason. It must not restate the hazard
  (a tombstone that re-exposes a secret defeats its own purpose).
- **`original_sha256`** — the SHA-256 of the exact bytes that were removed. It
  commits to what was there without republishing it, so an auditor with a prior
  copy can confirm the tombstone redacted *that* content and not a substitute.
- **`signature` / `key_id`** — an Ed25519 detached signature over `JCS(body sans
  signature)`, under the **checkpoint key**. Redaction is an operator act and is
  publicly attributable to the same key that signs the log; `key_id` must equal
  the identity pinned at [`CHECKPOINT_KEY.pub`](CHECKPOINT_KEY.pub). The `id` is
  part of the signed body (unlike a null record, whose id is derived from the
  body and excluded from it).

Signing and verification reuse the record/checkpoint identity scheme
(`core.signDetached` / `core.verifyDetached`); see
[`cli/lib/tombstone.js`](../cli/lib/tombstone.js).

## Process

1. **Report.** A hazard is reported via the [`security.txt`](../site/.well-known/security.txt)
   contact path — not a public issue that would amplify the exposure.
2. **Verify grounds.** The executor confirms the content falls under an
   [SPEC.md §2](../SPEC.md#2-what-is-explicitly-out-of-scope-for-a-record)
   exclusion. Wrongness is refused as grounds; those reports become
   `attest --verdict refuted` / supersession instead.
3. **Tombstone PR.** The executor authors the tombstone with the checkpoint key,
   replacing the body file in place, and opens a PR.
4. **Merge.** `validate` CI accepts the modification only because it is a valid
   body → tombstone transition (see below), then it merges.

## Immutability

A tombstone is itself immutable once merged. The registry stays add-only with
exactly one carve-out: a file under `registry/records/` or
`registry/verifications/` may be **modified only** when

- the new content validates against the tombstone schema
  ([`nrs-tombstone-0.1.schema.json`](schema/nrs-tombstone-0.1.schema.json)),
- its `id` matches the path (filename == hash, shard == prefix),
- its `key_id` is the pinned checkpoint key and its signature verifies, and
- its `original_sha256` matches the bytes being removed.

Everything else remains forbidden:

- **Deletion** of any registry file — forbidden.
- **body → body** modification (any non-tombstone change) — forbidden.
- **tombstone → anything** (modifying an existing tombstone) — forbidden.

This is enforced by [`check-add-only.js`](../registry/scripts/check-add-only.js)
in the `validate` workflow, and each committed tombstone is re-validated on every
run by [`validate-all.js`](../registry/scripts/validate-all.js).
