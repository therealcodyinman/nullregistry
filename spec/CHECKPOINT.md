# NRS-C-0.1 — Signed Merkle Checkpoints

**Status:** draft. This document defines how the registry publishes a signed,
append-only *transparency log* over its records, so any consumer can verify a
record's inclusion and the log's history **without trusting GitHub or the
operator**. It is the transparency-log pattern (Certificate Transparency, Rekor)
implemented over the existing Git store — no new service, no database.

A checkpoint is a signed statement: *"at this commit, the registry contained
exactly these N leaves, whose Merkle root is R."* Because record and verification
ids are already content hashes, a checkpoint plus a tiny inclusion proof lets
anyone confirm a record is in the log, and recomputation over the public repo
lets anyone confirm one checkpoint is a faithful extension of the last.

## Leaves

The leaves of the tree are **every record and verification id string**, i.e. the
UTF-8 bytes of each `nr:sha256:…` / `nrv:sha256:…` id, **sorted lexicographically**
(by UTF-16 code unit, which for these ASCII ids equals byte order; all `nr:`
sort before all `nrv:`).

The leaf is the **id**, not the file bytes. The id is already the SHA-256 of the
record's canonical body (see [CANONICALIZATION.md](CANONICALIZATION.md)), so
using it as the leaf keeps proofs tiny and independent of file formatting or path
layout. Filename == id-hash and directory == id-prefix are CI-enforced invariants
([validate-all.js](../registry/scripts/validate-all.js)), so the leaf set is
recoverable from paths alone.

## Tree

An RFC 6962-style Merkle tree with domain-separated hashing, combined
level-by-level with **odd-node promotion**:

```
leafHash(leaf)      = SHA-256( 0x00 || leaf )
nodeHash(L, R)      = SHA-256( 0x01 || L || R )
```

Build the bottom level as `leafHash` of every leaf, then repeatedly combine:
pair nodes left-to-right (`[0,1], [2,3], …`); if a level has an odd count, the
final unpaired node is **carried up unchanged** (not duplicated). Repeat until
one node remains — the **root**, emitted as lowercase hex. The empty tree's root
is `SHA-256("")`, but checkpoints are never empty (the builder refuses).

An **inclusion proof** for a leaf is the ordered list of sibling hashes needed to
recompute the root, each tagged with the sibling's side (`left`/`right`); levels
where the leaf's node was promoted contribute no step. `nullreg prove` produces
and checks these.

## Checkpoint document

Stored at `checkpoints/<n>.json`, where `n` is a monotonically increasing integer
(1, 2, 3, …). `n` lives in the filename, not the body.

```json
{
  "checkpoint_version": "0.1",
  "origin": "nullregistry.org",
  "size": 30,
  "root": "<hex sha256>",
  "created": "2026-08-08T00:00:00Z",
  "git_commit": "<sha of the tree state the root was computed over>",
  "prev_checkpoint": "<hex sha256 of the previous checkpoint file>|null",
  "signature": "<base64url Ed25519 over the JCS body sans signature>",
  "key_id": "ed25519:<base64url SPKI DER of the checkpoint public key>"
}
```

- **`root`** — Merkle root over the sorted leaves, as above.
- **`git_commit`** — the commit whose `registry/` tree the root was computed over.
  An auditor recomputes the root at exactly this commit.
- **`prev_checkpoint`** — SHA-256 of the *file bytes* of `checkpoints/<n-1>.json`,
  `null` for the genesis checkpoint (n = 1). This hash-chains checkpoints.
- **`signature`** — Ed25519 over `JCS(document without "signature")`. The same
  identity and detached-signature construction as records, so one code path
  signs and verifies both.
- **`key_id`** — the signing key's public identity; a checkpoint is
  self-verifying. It must match [`CHECKPOINT_KEY.pub`](CHECKPOINT_KEY.pub).

### Latest pointer

`checkpoints/latest.json` is a byte-for-byte copy of the newest numbered
checkpoint. It is **the one file in the repo permitted to change** — every other
tracked file is add-only. CI enforces that numbered checkpoints are add-only and
that `latest.json` always equals the highest-numbered checkpoint.

## Consistency

Between two checkpoints, consistency is verified by **recomputation over the
public repo**: for each checkpoint, recompute the Merkle root over the registry
as it existed at that checkpoint's `git_commit` and confirm it equals `root` and
`size`; confirm the `prev_checkpoint` hash chain back to genesis; confirm the
signature. This is [`verify-checkpoint.js`](../registry/scripts/verify-checkpoint.js),
and it needs only a full clone. (Succinct RFC 6962 consistency proofs — proving
append-only-ness without full recomputation — are a v3 item; see
[ROADMAP.md](ROADMAP.md).)

## The signing key

One Ed25519 checkpoint keypair signs the log. The **private key lives only as the
GitHub Actions secret `CHECKPOINT_KEY_PEM`** (PKCS8 PEM) and is never committed.
The public identity is pinned at [`CHECKPOINT_KEY.pub`](CHECKPOINT_KEY.pub); the
first keyed run of `checkpoint.js` writes it automatically from the secret.

Generate the keypair locally and set the secret (human/executor step):

```bash
# private key (PKCS8 PEM) → GitHub Actions secret CHECKPOINT_KEY_PEM
openssl genpkey -algorithm ed25519 -out checkpoint_key.pem
gh secret set CHECKPOINT_KEY_PEM < checkpoint_key.pem
# then destroy the local copy; the secret is the only durable home
```

**Threat model.** A leaked key lets an attacker sign a *fraudulent* root — but it
cannot alter Git history or any mirror. Detection is immediate: recomputation
over the public repo (by CI, by `verify-checkpoint.js`, by any mirror) yields a
different root than the fraudulent signature claims, and the mismatch is public.
The key signs an assertion about the log; it does not control the log.

**Rotation.** To rotate, commit the new public identity to `CHECKPOINT_KEY.pub`
alongside a **signed handover statement** (the old key signing the new `key_id`),
update the `CHECKPOINT_KEY_PEM` secret, and let the next checkpoint sign under the
new key. Checkpoints are self-describing via `key_id`, so historical checkpoints
remain verifiable under the old key; auditors accept a key change only when it is
covered by a valid handover.
