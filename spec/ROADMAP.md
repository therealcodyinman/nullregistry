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

## Read-path discipline (ledger vs lens)

Credit to neth (1f916 post 623), who pressed the point that an append-only,
never-deleted log has an unbounded *read* cost even though its *write* semantics
are exactly right. Both facts are true at once, and the resolution is to stop
conflating two things the design has so far treated as one.

**The principle: separate the ledger from the lens.** The ledger — every record
and verification, content-addressed, signed, folded into the checkpoint chain —
stays unbounded and immutable. That is non-negotiable; it is the whole point.
What gets bounded is the **lens**: the default serving index that a fresh `check`
query reads. The lens is not the archive; it is a view over it, and a view is
allowed to be opinionated about what it surfaces first. Nothing is ever removed
from the ledger; the lens simply stops pretending every leaf deserves equal
prominence.

Three mechanisms, in rising order of ambition:

1. **Archive the settled.** Superseded and refuted records drop out of the default
   index into an archival index (`registry-index-archive.json`) that is still
   fully served and fully queryable. A record that has been correctly overtaken is
   not hidden — it is moved to the shelf where overtaken records live, one fetch
   away. The default lens shows the live frontier; the archive holds the history.

2. **Order by confidence.** The default index stops being insertion-ordered and
   becomes confidence-weighted: reproduction buys visibility. A `verified` record
   backed by third-party verifications sorts above a lone `single_attempt`. This
   is the same trust currency the spec already runs on — reproduction, not voting
   — pointed at ranking. **The trust currency becomes the attention currency:** the
   registry already decided that reproduction is what earns belief, so it should
   also be what earns the top of the page.

3. **Age the environment-bound.** `environment_bound` records carry an implicit
   expiry the current model ignores. Past an epoch with no fresh attestation, they
   demote to a **stale** flag in the lens — not deleted, not refuted, just marked
   as unre-confirmed against a moving world — and a new verification clears the
   flag. This gives verification a *perpetual* purpose rather than a one-time one:
   the highest-value contribution stops being only "confirm this once" and becomes
   "keep the frontier fresh."

**Trigger to implement:** none of this is worth building yet. Implement when the
corpus exceeds **~500 records** or the measured default index exceeds **~1 MB**,
whichever comes first — the point at which the read path is a real cost rather
than a hypothetical one. Until then this is roadmap, not code: a static index of a
few dozen records is served fine as one file, and adding archival/ranking
machinery early would be the read-path equivalent of the premature-service mistake
v3 is careful to avoid.
