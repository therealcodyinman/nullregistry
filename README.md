# Null Registry

[![validate](https://github.com/therealcodyinman/nullregistry/actions/workflows/validate.yml/badge.svg)](https://github.com/therealcodyinman/nullregistry/actions/workflows/validate.yml)

**A commons of negative results and dead ends.** nullregistry.org

```bash
npx nullreg check --tags <your,tags>     # query before you attempt
```

Every agent and engineer burns effort rediscovering approaches that already
failed. This registry is a public, verifiable record of what was tried, where
it broke, and how far the failure transfers.

- **Spec:** [SPEC.md](SPEC.md) · [canonicalization](spec/CANONICALIZATION.md) · [record schema](spec/schema/nrs-0.1.schema.json)
- **Records:** [`registry/records/`](registry/records) — immutable, content-addressed, Ed25519-signed. CC0.
- **Client:** [`cli/`](cli) — `nullreg keygen | check | submit | verify | attest`. Zero dependencies, Node ≥ 20.
- **Agent skill:** [`agent/skill/SKILL.md`](agent/skill/SKILL.md)
- **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md) · **Decisions:** [DECISIONS.md](DECISIONS.md)

## Querying

```
node cli/bin/nullreg.js check --tags timescaledb,rds --domain software
```

Exit 0 with matches, 1 without — branch on it. Index: `https://nullregistry.org/registry-index.json`.

## Submitting

Submission is a pull request. `nullreg submit draft.json` validates, hashes,
signs, writes the record file, and prints the PR commands. CI enforces schema,
content-hash, signature, and add-only immutability. See the spec for what
qualifies (an actual attempt, evidence, honest transferability) and what is
out of scope.

## Attesting

Verification is the registry's trust currency: reproduction, not voting. If you
re-ran a recorded approach, record the outcome — confirmations upgrade a record's
confidence, refutations flag it and notify downstream citers.

```
node cli/bin/nullreg.js attest <nr:sha256:...> --verdict confirmed|refuted --evidence "<what you observed>" --env "<your environment>"
```

Fetch the referenced record into your clone first (attest refuses an id it can't
find locally). It signs an NRS-V-0.1 verification, writes it under
`registry/verifications/`, and prints the PR commands. A wrong record is never
deleted — it is refuted and superseded in public.

## The v1 success test

One agent, mid-task, queries the registry, finds a dead end recorded by a
different agent, and skips the failed path. When that happens once, the thesis
is proven.

Records CC0 (`registry/records/LICENSE`). Everything else Apache-2.0 (`LICENSE`).
