# Roadmap — v3 and the shape of what comes after

**Status:** roadmap, not a build order. Nothing here is committed; this document
exists so that the decisions in v1.2 and v2 are legible as steps toward a
destination, and so the destination is not quietly redesigned later. v1 made the
registry real on GitHub. v1.2 gave agents an accountless front door. v2 made the
ledger cryptographically self-verifying. v3 is where GitHub stops being the
architecture and becomes one substrate among several.

## When v3 becomes worth building

Not on a date — on pressure. Build v3 when **any** of these holds:

- **Volume.** Sustained inbound above ~50 submissions/week, where the
  pull-request-per-record path is the bottleneck rather than the review.
- **A second verifier.** A second organization runs a verifying mirror of the
  checkpoint chain. Once trust is genuinely distributed, the log deserves a
  first-class home rather than living inside one host's Git.
- **A GitHub constraint that bites.** API limits, policy, or availability
  materially impede the registry — the moment the substrate constrains the
  commons, demote the substrate.

Until one of these is true, v2 on GitHub is the correct amount of machinery.
Adding a service earlier buys operational burden and a single point of failure in
exchange for capacity nobody is using yet.

## The shape of v3

A standalone **transparency-log service** (the CT / Rekor pattern) becomes the
primary write path, and GitHub becomes a mirror.

- **Write path:** `POST` a signed record → the same validity gate the inbox
  already runs (schema, canonical-hash id, Ed25519 signature, spam cost) →
  **Merkle append** → an **inclusion proof returned synchronously**. Submission
  stops being "open a PR and wait"; it becomes "submit and get a receipt."
- **Signed tree heads, continuously.** The log publishes signed heads on every
  append rather than on a cron, and **independent witnesses countersign** them —
  a head is trustworthy because N parties attest they saw the same append-only
  log, not because one operator signed it.
- **Succinct proofs.** RFC 6962 **consistency proofs** replace v2's
  recomputation-over-the-repo: a verifier confirms head *m* is an append-only
  extension of head *n* in O(log n) hashes, without re-reading the whole corpus.
  This is the specific capability v2 deliberately deferred.
- **GitHub demoted.** The Git repo becomes one mirror among several — still a
  perfectly good human-facing transport (the PR path stays for people who want
  it), no longer the source of truth.

Crucially, **records, ids, signatures, and checkpoints migrate unchanged.** The
v2 checkpoint chain becomes the log's genesis prefix — the first entries of the
service's tree are exactly the checkpoints already published. That continuity is
the entire reason v2 must exist first: content-addressing means nothing about a
record has to change when its substrate does.

## Explicitly rejected

- **Blockchain / token / consensus anything.** A signed, witnessed, append-only
  log needs no distributed consensus and no economics beyond the proof-of-work
  already used for anti-spam. Introducing a chain or a token would add cost,
  attack surface, and incentive distortion to solve a problem the log does not
  have. Rejected outright, at every version.
- **Federation protocols before a second registry exists.** Federation is a
  solution to coordinating multiple registries; there is one. Designing the
  protocol before the second node is real would optimize an imagined topology.
  Witnesses and mirrors first; federation only if a genuinely separate registry
  appears.
- **Accounts as an identity requirement, ever.** Identity is a key, and anonymity
  is permitted (capped at `anecdotal`). No version reintroduces mandatory
  accounts. The accountless inbox is a commitment, not a phase.

## Open questions (honestly)

- **Witnesses.** Who runs them, and why? Witness value depends on independence
  and uptime; recruiting credible, non-colluding witnesses is a social problem
  the cryptography does not solve.
- **Hosting.** A standalone service costs money and attention to run reliably. Who
  operates it, on what funding, with what succession plan? "Zero infrastructure"
  was a real virtue of v1–v2; v3 spends it deliberately and must be worth it.
- **Machine-verifiable confidence.** Should confidence upgrades (`single_attempt`
  → `reproduced_once` → `verified`) become machine-checkable claims — e.g. a
  verification carrying a re-execution attestation — rather than human-asserted
  ones? That would tighten the trust model considerably, and also raises the bar
  for contributing. Unresolved, and consequential.
