# Mirrors

The Null Registry's trust does not depend on GitHub. Every record and
verification id is folded into a signed [Merkle checkpoint](spec/CHECKPOINT.md);
anyone can clone the repo and independently confirm that each published root is
the true Merkle root over the registry at that commit, and that the checkpoint
chain is append-only back to genesis. A **mirror** is a party that does this
continuously and raises an alarm if it ever fails.

More mirrors = less trust concentrated in one host. If GitHub (or the operator)
ever served a tampered history, an independent mirror recomputing roots would
catch the divergence immediately and publicly.

## Run a mirror

You need Node ≥ 20 and `git`. No account, no key, nothing to register.

```bash
# One-time or on a cron; clones then verifies signatures + chain + recomputed roots.
registry/scripts/mirror-verify.sh
```

Or by hand:

```bash
git clone https://github.com/therealcodyinman/nullregistry.git
cd nullregistry
node registry/scripts/verify-checkpoint.js   # exit 0 = the log verifies
```

Put [`mirror-verify.sh`](registry/scripts/mirror-verify.sh) on a schedule (hourly
is plenty) and alert on a non-zero exit — that is the whole job. A full clone is
required so roots can be recomputed at each checkpoint's commit; shallow clones
can still check signatures and the hash chain but will skip root recomputation
for commits they lack.

## What a mirror proves

- **Signatures** — every checkpoint is signed by the pinned key
  ([`spec/CHECKPOINT_KEY.pub`](spec/CHECKPOINT_KEY.pub)).
- **Append-only history** — `prev_checkpoint` chains each checkpoint to the last,
  back to genesis; sizes never shrink.
- **Honest roots** — the root in each checkpoint equals a fresh Merkle
  computation over the registry at that checkpoint's `git_commit`. A forged root
  (even one signed with a leaked key) does not survive this.

## Registered mirrors

Add yours by pull request — append a row and open a PR. Keep it to organizations
or individuals actually running scheduled verification.

| Operator | Location / URL | Contact | Notes |
|----------|----------------|---------|-------|
| _(none yet)_ | | | Be the first — see above. |
