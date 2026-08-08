# Decisions Log

Judgment calls made during the v1 build where the founding spec was silent or
where execution diverged from the original plan. Architect: Claude. Executor: Cody.

1. **Monorepo instead of two repos.** The spec called for `nullregistry/spec` +
   `nullregistry/registry`; a single `nullregistry` repo was created. Adopted as
   the better v1 call: `spec/`, `registry/`, `cli/`, `site/`, `agent/` as
   top-level directories, one CI pipeline. Split later only if contribution
   traffic demands it.

2. **Filenames omit the `nr:sha256:` prefix.** `:` is not portable across
   filesystems (Windows). Filename = hex digest; CI enforces filename == id hash.

3. **The v1 "API" is generated at deploy time.** The query index is built by the
   Pages workflow and served at `https://nullregistry.org/registry-index.json`,
   not committed to the repo. One source of truth, no bot commits. The CLI takes
   `--index-url` / `--index-file` overrides.

4. **Minimal vendored JCS + JSON Schema subset, zero dependencies.** Records use
   only strings/arrays/objects/integers, so a small verified implementation of
   RFC 8785 and of the schema-keyword subset we use (type, required, properties,
   additionalProperties, enum, items, pattern, minLength, format:date-time) was
   chosen over pulling ajv + canonicalize as dependencies. Boring and auditable
   beat ecosystem-standard here; revisit if the schema grows features.

5. **Seed identity is single-use and its private key was destroyed.** The 10 seed
   records are signed by `nullregistry-seed` (identity in each record); the key
   existed only in the process that signed them. That identity can never author
   again, which caps its blast radius. Future records come from durable identities.

6. **Seed confidence capped at `reproduced_once`.** All ten seeds describe
   vendor-documented, independently reproducible behavior, but per the spec's
   trust model `verified` must come from third-party verification records, not
   author self-assessment — even the founder's.

7. **Seed authorship marked `mixed`.** Drafted by the architect (an AI), curated
   and executed with a human. `mixed` is the honest value.

8. **`created` timestamps on seeds are uniform** (2026-08-06T18:30:00Z, the build
   time). They record when the record was authored, not when the failure was
   discovered — several of these dead ends are decades old.

9. **Schema `superseded_by` is typed `null` in 0.1.** Records are immutable, so a
   record can never carry its own successor pointer post-hoc; supersession is
   discovered by scanning `supersedes` edges (the index exposes them). The field
   exists in the schema so 0.2 can debate removing vs. repurposing it explicitly.

10. **Landing page ships with one embedded example record** (the TimescaleDB/RDS
    constraint) rendered as the hero — the registry's actual content is the pitch.
    Styled per spec: system fonts, no framework, no build step, single accent.

11. **`nullreg submit` prints the PR commands instead of opening the PR**, per the
    handoff constraint. Auto-PR is a v1.1 candidate once abuse surface is thought
    through.

---

## v1.1 (post-launch hardening)

Architect: Claude. Executor: Cody. Continuing the numbering.

12. **Cloned origin into an empty working directory.** The v1.1 handoff assumed a
    local clone, but the working directory was empty and not a git repo. The
    remote `main` matched the described v1 exactly (spec, CLI, 10 seeds, CI), so
    the correct action was to clone it into place and branch `v1.1` — not to treat
    the handoff's premises as false.

13. **`nrv:` construction reuses the null-record canonical body verbatim; only the
    prefix differs.** Extended `cli/lib/core.js` with `hashCanonicalBody`,
    `computeVerificationId`, and `verifyVerification`; verification signing reuses
    `signRecord`/`canonicalBody` unchanged. `validate-all.js` was refactored to
    call `core.computeVerificationId` instead of re-deriving the hash inline —
    extend core, don't duplicate, per the handoff.

14. **`validate-all.js` now enforces the verification signature.** Previously it
    checked a verification's schema, content-hash, and reference existence but not
    its Ed25519 signature. The spec's trust model states every record is signed, so
    signature verification (via `core.verifyVerification`) is now enforced. Strictly
    stronger; every verification `attest` produces signs correctly.

15. **`attest` refuses an absent reference and a missing identity.** It exits 1 if
    the referenced `nr:` record is not present under `registry/records/` in
    `--repo` (fetching the record is the human's job, per the handoff), and exits 2
    with guidance if no `~/.nullreg` identity exists (run `keygen` first).

16. **`attest` author defaults and timestamp.** `author.type` defaults to `agent`
    (`--author-type` overrides to `human`/`mixed`); `author.model` is omitted (a
    verifier's model isn't meaningful for a reproduction claim and the field is
    optional). `created` strips milliseconds from `toISOString()` to match the seed
    timestamp style; the schema/validator accept both forms.

17. **`attest` tests are end-to-end, spawning the CLI.** To exercise the local-file
    refusal and "schema validity of produced files" faithfully, the tests spawn
    `nullreg attest` against a temp repo with a temp `HOME` (redirecting `keygen`),
    plus a fast in-core id/signature round-trip and tamper test. They live in
    `cli/test/attest.test.js`, so the existing `cli/test/*.test.js` CI glob runs
    them with no workflow change.

18. **Batch-2 seed guard is count-based, not content-based.** Each run mints a fresh
    single-use identity, which is part of the canonical body, so content-addressed
    ids differ every run — file-existence cannot make the batch idempotent (an
    early content-based guard produced 20 duplicates before this was caught).
    `seed-batch2.js` instead refuses unless exactly the 10 founding seeds are
    present, the only state in which appending the batch is correct.

19. **Batch-2 `created` is a uniform constant** (`2026-08-07T16:00:00Z`), same
    rationale as #8 — it records authoring/build time. Confidence policy: only
    deterministic, source-documented behavior is `reproduced_once`; statistical or
    principle-level failures (test-set reuse, the "network is reliable" fallacy) are
    `single_attempt`. No batch-2 record claims `verified`. Domain spread of the 20:
    10 software, 4 ml, 3 ops, 3 math (10 non-software).

20. **`attest` prints the PR commands only**, never opens the PR — mirrors #11 and
    keeps the human in the loop for the one network-facing step.

---

## Settings hardening + v0.1.0 release

21. **Branch protection uses the classic branch-protection API** (`PUT
    /branches/main/protection`), not a ruleset — it succeeded first, per the
    handoff's "pick whichever succeeds first" instruction. Config: require a PR
    (0 approvals — CI is the gatekeeper), require the `validate` check (strict),
    block force-pushes and deletions, `enforce_admins: true`. Verified by a
    rejected direct push of an empty commit to `main` as the owner.

22. **Pages `status` stays `null` for a workflow-built site.** The legacy
    `status` field in the Pages API is only populated for branch (Jekyll) builds;
    for `build_type: workflow` it remains `null` even after a successful publish.
    Authoritative release signals are instead the green `deploy-pages` run, the
    live `200`, and `registry-index.json` returning `count: 30`. HTTPS was enforced
    once the certificate reached `approved`.

23. **npm package name is `nullreg` (unscoped).** `npm view nullreg` returned 404
    (available), so no scope is needed; README install examples use bare `nullreg`.

24. **Schema bundling for the npm tarball.** `spec/schema/` stays canonical; a
    committed mirror at `cli/schema/` ships in the package `files`, and
    `cli/lib/schema.js` resolves packaged-first then repo-path. A CI drift check in
    `validate.yml` diffs the two, and `cli/test/schema.test.js` asserts the CLI
    resolves through the packaged path and that the copies are byte-identical — so
    the mirror can never silently diverge.

25. **`npm publish` is the one remaining human step.** No npm auth is available in
    this environment (`npm whoami` → ENEEDAUTH), so the package is fully prepared
    and the exact publish command is documented in the release PR; a maintainer
    with npm auth runs `npm publish --provenance` from `cli/`.

---

## Standard site files

26. **No `manifest.json`.** The site is a two-page static commons whose primary
    audience is agents, not an installable web app — a PWA manifest would be
    cargo-culting. Explicitly decided against.

27. **`include-hidden-files: true` on the Pages artifact upload, proactively.**
    `actions/upload-pages-artifact@v3` wraps `actions/upload-artifact@v4`, which
    excludes dotfiles/dotdirs by default — so `site/.well-known/security.txt` would
    silently 404 while `site/security.txt` served. Rather than ship, observe the
    404, and redeploy, the flag was set with the site files. Post-merge
    verification: `/.well-known/security.txt` must return 200 (if it still 404s,
    the input isn't being forwarded and needs another approach — recheck here).

---

## v1.2 — accountless submission inbox

Architect: Claude. Executor: Cody. Continuing the numbering.

28. **The "no server" rule is bent for a front door, not for the ledger.** v1's
    pitch is "no accounts, no server." The inbox adds a *stateless relay* (a
    Cloudflare Worker) so agents with no GitHub account can submit — but it holds
    no ledger: no database, no accounts, KV only for rate-limit counters. The Git
    repo remains the registry of record and `validate` CI remains the
    authoritative gate; the Worker only front-runs the mechanical checks so
    garbage never becomes a PR. If the Worker vanishes, the hand-authored PR path
    is unchanged. The landing-page copy was softened accordingly ("no account
    needed"), not contradicted — writes still land as PRs gated by CI.

29. **Proof-of-work instead of accounts as the spam economics.** With no account
    to rate-limit against, an anonymous POST endpoint needs a cost. NRS-T-0.1
    requires a `sha256-lead0` stamp — `leadingZeroBits(sha256(record.id + ":" +
    nonce)) ≥ bits` — in the envelope, never in the record (records stay
    hash-stable). The stamp binds to `record.id` (itself the hash of the body), so
    it cannot be precomputed without committing to exact content. This prices bulk
    submission in CPU while a single honest submission costs a second or two.

30. **Launch difficulty 20 bits; rate limits 5/author, 20/IP, 50/global per day —
    all expected to be tuned.** 20 bits is ~1–2s of one CPU: negligible for a real
    contributor, linear cost for a flood. The relay enforces its own *minimum* and
    returns `retry-with-higher-bits` with `required_bits` so the difficulty can be
    raised without a client release; `nullreg submit --via inbox` honors it and
    re-solves. KV rate-limit increments are non-atomic (no atomic incr in KV), so
    counts can undercount slightly under a simultaneous burst — accepted because
    PoW is the real cost floor and the buckets are a coarse damper, not a meter.

31. **Runtime-agnostic crypto via WebCrypto, ported not shared.** The Worker can't
    `require('node:crypto')`, so `core.js`/`validate.js` were ported to
    `inbox/worker/lib/` using `crypto.subtle` (Ed25519 + SHA-256), which exists in
    both the Workers runtime and Node ≥ 20 — so `node --test` exercises the exact
    functions the Worker runs. The schema and validator are vendored copies guarded
    against drift by deep-equal / behavioral-parity tests against the canonical
    `spec/schema/` and `cli/lib/validate.js`, mirroring the `cli/schema/` drift
    check. The CLI keeps its own `node:crypto` stamp implementation (CommonJS);
    both conform to the one spec (TRANSPORT.md) and both are unit-tested.

32. **SPEC.md is not edited; transport gets its own spec.** Transport is not the
    record format, so NRS-0.1 is untouched. NRS-T-0.1 lives in `spec/TRANSPORT.md`
    and adds no record fields. The accountless path does not confer trust: SPEC §3
    still caps confidence and reserves `verified` for independent verification
    records — arrival mechanism grants nothing.
