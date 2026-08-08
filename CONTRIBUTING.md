# Contributing to the Null Registry

The registry is a commons of **negative results**: one record = one real attempt
against one problem that did not work, with enough context to judge whether the
failure transfers. Contribution is a pull request. There are no accounts and no
web writes — the PR *is* the submission.

Read first: [SPEC.md](SPEC.md) · [canonicalization](spec/CANONICALIZATION.md) ·
[record schema](spec/schema/nrs-0.1.schema.json) ·
[verification schema](spec/schema/nrs-verification-0.1.schema.json).

Everything below is enforced by CI (`node registry/scripts/validate-all.js` and
`node --test cli/test/*.test.js`). Run both before opening a PR.

## What belongs here (and what does not)

A record needs an **attempt** and **evidence** — not a hunch. The following are,
verbatim from [SPEC.md §2](SPEC.md#2-what-is-explicitly-out-of-scope-for-a-record),
explicitly out of scope:

> - Opinions, hunches, or "I feel like this won't work" — there must be an *attempt* with *evidence*.
> - Secrets, credentials, personal data, proprietary code. Artifacts must be publicly reachable or omitted.
> - Anything whose primary value is instructions for causing harm. The registry records failed approaches to legitimate problems; it is not a catalog of what almost worked for illegitimate ones. Moderation policy inherits this line.

## Drafting a record — field by field

Author a draft JSON with **no `id` and no `signature`** (both are added at submit
time). Every field below maps to the [schema](spec/schema/nrs-0.1.schema.json);
`additionalProperties` is `false`, so unknown fields are rejected.

- **`nrs_version`** — `"0.1"`.
- **`problem.statement`** — what was attempted, plainly (≥ 20 chars).
- **`problem.fingerprint.domain`** — one of `software | ml | math | bio | chem | ops | other`.
- **`problem.fingerprint.tags`** — lowercase, specific; these are what `nullreg check` matches on.
- **`approach.summary`** — what was tried (≥ 10 chars). Optional `approach.detail`, `approach.artifacts` (public URIs only).
- **`failure.mode`** — one of `incorrect_result | performance | instability | dead_end_reasoning | resource_exhaustion | external_constraint`.
- **`failure.point`** — where exactly it broke.
- **`failure.evidence`** — the concrete proof: error output, a measurement, a counterexample, or a **cited** source (docs, spec, paper). This is the field reviewers scrutinize most.
- **`environment.description`** — versions, hardware, data characteristics, assumptions.
- **`transferability.scope`** — `universal | environment_bound | data_bound | unknown`.
- **`transferability.notes`** — **required judgment: state explicitly when the failure does NOT apply.** Overgeneralized dead ends are this registry's primary failure mode. `unknown` is an honest answer.
- **`confidence.level`** — `verified | reproduced_once | single_attempt | anecdotal`. You do **not** self-assign `verified` — that comes only from third-party verification records (see below). A first, single recording is `single_attempt` (or `anecdotal` for an unsigned/one-off). `reproduced_once` only when your cited source documents reproduction.

### A full example draft

```json
{
  "nrs_version": "0.1",
  "problem": {
    "statement": "Sort an array of numbers numerically with Array.prototype.sort() and no comparator in JavaScript.",
    "fingerprint": { "domain": "software", "tags": ["javascript", "array-sort", "comparator"] }
  },
  "approach": { "summary": "Call [1, 2, 10, 21].sort() and expect ascending numeric order." },
  "failure": {
    "mode": "incorrect_result",
    "point": "With no comparator, sort() compares elements as strings by UTF-16 code unit, so 10 sorts before 2.",
    "evidence": "ECMAScript spec (Array.prototype.sort) and MDN document the default lexicographic comparison; [1,2,10,21].sort() yields [1,10,2,21]."
  },
  "environment": { "description": "All ECMAScript engines." },
  "transferability": {
    "scope": "universal",
    "notes": "Specified across engines; an explicit numeric comparator fixes it. Does not apply to TypedArray.prototype.sort, which is numeric by default."
  },
  "confidence": { "level": "reproduced_once", "notes": "Spec-defined; trivially reproducible." }
}
```

## Submitting

```bash
node cli/bin/nullreg.js keygen                       # once per identity → ~/.nullreg
node cli/bin/nullreg.js submit draft.json --repo .   # validates, hashes, signs, writes the record file
```

`submit` prints the exact `git`/`gh` commands to open the PR. Your identity is an
Ed25519 public key; reputation accrues to it over time. Anonymous submission is
allowed but permanently capped at `anecdotal` confidence.

## Accountless submission (no GitHub account)

If you have no GitHub account, you can still land a record: a stateless relay
opens the pull request for you. You sign the record exactly as above, attach a
proof-of-work stamp (CPU instead of an account, as the anti-spam price), and POST
it. The relay runs the same mechanical checks and opens a PR labeled `inbox`;
from there it flows through `validate` CI like any other PR.

```bash
node cli/bin/nullreg.js keygen                          # once per identity
node cli/bin/nullreg.js submit draft.json --via inbox   # signs, stamps (PoW), POSTs, prints the PR url
```

- Difficulty is **20 leading zero bits** at launch (a second or two of CPU);
  override with `--bits`, though the relay enforces its own minimum and the CLI
  automatically re-solves if asked for more.
- The endpoint defaults to `https://inbox.nullregistry.org/v1/submit`; override
  with `--inbox-url`.
- The stamp lives in the transport envelope, never in the record — records stay
  byte-identical whether submitted by PR or inbox.

This transport is defined in [spec/TRANSPORT.md](spec/TRANSPORT.md) (NRS-T-0.1)
and documented operationally in [inbox/README.md](inbox/README.md). It is a front
door, not the ledger: the Git repo remains the registry of record, and if the
relay is down the hand-authored PR path above is unaffected.

## Attesting (verify or refute a record)

The highest-value contribution is **reproduction**. If you re-ran a recorded
approach, record the result — confirmations upgrade confidence, refutations flag
the record. Fetch the referenced record into your clone first, then:

```bash
node cli/bin/nullreg.js attest <nr:sha256:...> \
  --verdict confirmed|refuted \
  --evidence "what you observed re-running it" \
  --env "your environment" \
  [--author-type agent|human|mixed]   # default: agent
```

This writes `registry/verifications/<hh>/<hash>.json` and prints the PR commands.
**A wrong record is never deleted — it is refuted and superseded in public.** To
challenge a record, open a [dispute](.github/ISSUE_TEMPLATE/dispute-record.md);
the resolution path is an `attest --verdict refuted`, not a deletion.

## The PR flow

1. Branch, add only your new file under `registry/records/` or `registry/verifications/`, commit.
2. Open the PR (the [template](.github/PULL_REQUEST_TEMPLATE.md) is a checklist).
3. CI validates schema, content-hash, signature, filename, and enforces that the
   registry is **add-only** — existing records are immutable and may never be
   modified or deleted.

Records are CC0; the spec and tooling are Apache-2.0.
