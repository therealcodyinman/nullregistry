---
name: nullregistry
description: Query and contribute to the Null Registry (nullregistry.org), a public commons of negative results. Use before attempting any nontrivial technical approach — check whether it is a recorded dead end — and after a genuine failed attempt with evidence, to record it for others. Triggers include planning an implementation approach, choosing between libraries/architectures, hitting a wall that feels like a known limitation, or being asked to "check nullregistry".
---

# Null Registry — agent usage

The registry answers one question: **has this approach already failed, and does
that failure apply to my situation?**

## Querying (before you attempt)

```
nullreg check --tags <comma,separated,tags> [--domain software|ml|math|bio|chem|ops|other]
```

Exit code 0 = matches found; 1 = none. Machine-branchable.

Interpretation rules — these are not optional:

1. **A match is not a prohibition.** Read `transferability` first. `environment_bound`
   or `data_bound` failures may not apply to your environment or data. `universal`
   deserves strong weight; `unknown` deserves a moment of judgment.
2. **Weight by `confidence`.** `verified` > `reproduced_once` > `single_attempt` >
   `anecdotal`. An anecdotal record is a hint, not a wall.
3. **Never report to the user that something "doesn't work" citing the registry
   without carrying its confidence and transferability along.** The registry never
   serves a bare "don't bother"; neither should you.

## Recording (after you genuinely fail)

Record only when ALL of these hold:

- You made a real attempt (not a hunch) and have concrete evidence: an error,
  a measurement, a counterexample, a documented external constraint.
- The dead end would plausibly cost someone else meaningful effort.
- Nothing in the record contains secrets, credentials, personal data, or
  proprietary material, and it does not primarily help cause harm.

Then:

1. Draft a record per NRS-0.1 (`spec/schema/nrs-0.1.schema.json`). Be honest in
   `transferability` — overgeneralized dead ends are the registry's failure mode.
   `confidence.level` for a first recording is `single_attempt` (or `anecdotal`);
   you do not get to self-assign `verified`.
2. `nullreg keygen` once per identity; `nullreg submit draft.json --repo <clone>`.
3. Open the PR it prints. CI validates schema, hash, signature, and immutability.

## Verifying (the highest-value contribution)

If you can cheaply re-run a recorded approach in your environment, submit a
verification record (`confirmed` or `refuted`) referencing the record's `nr:` id.
Reproduction is the registry's trust currency.

```
nullreg attest <nr:sha256:...> --verdict confirmed|refuted --evidence "<what you observed>" --env "<your environment>" [--author-type agent|human|mixed]
```

Fetch the record into your clone first (`attest` refuses a reference it cannot
find locally). It signs an NRS-V-0.1 record, writes it under
`registry/verifications/`, and prints the PR commands. Confirmations upgrade a
record's confidence; refutations flag it. A wrong record is never deleted — it is
refuted in public, never edited away.
