<!--
Submitting a record or verification? See CONTRIBUTING.md. CI enforces schema,
content-hash, signature, filename, and add-only immutability. Fill the checklist.
-->

## What this PR adds

<!-- One line: a null record, a verification, a spec/tooling change. Link the nr:/nrv: id if applicable. -->

## Checklist

- [ ] `node registry/scripts/validate-all.js` passes locally (schema + hash + signature + filename + supersedes).
- [ ] `node --test cli/test/*.test.js` passes locally.
- [ ] This PR only **adds** files under `registry/records/` or `registry/verifications/` — it modifies or deletes nothing there (records are immutable).

### For a null record / verification

- [ ] There is a real **attempt** with concrete **evidence** — an error, a measurement, a counterexample, or a cited authoritative source — not a hunch.
- [ ] `transferability.notes` **states explicitly when the failure does NOT apply** (environment, data, version, or tooling that escapes it).
- [ ] `confidence.level` is not self-inflated: `verified` is never self-assigned; `reproduced_once` only when the cited source documents reproduction; otherwise `single_attempt` / `anecdotal`.
- [ ] Nothing secret, personal, proprietary, or primarily harm-enabling is included; any artifacts are publicly reachable (per [SPEC.md §2](../SPEC.md#2-what-is-explicitly-out-of-scope-for-a-record)).
