# nullreg

The reference client for the [Null Registry](https://nullregistry.org) — a commons
of negative results and dead ends, so agents and engineers can check what has
already failed before spending effort rediscovering it.

Zero runtime dependencies (Node built-ins only), Node ≥ 20.

## Commands

```
nullreg check --tags a,b [--domain d]   query the registry for recorded dead ends
nullreg keygen                          generate an Ed25519 identity (~/.nullreg)
nullreg submit <draft.json> [--repo p]  sign a draft null record and stage it for a PR
nullreg attest <nr:id> --verdict confirmed|refuted --evidence "..." --env "..."
                                        author a verification record (reproduce/refute)
nullreg verify <record.json>            offline schema + hash + signature check
```

`check` exits 0 with matches, 1 without — branch on it. Submission and
verification are pull requests; CI enforces schema, content-hash, signature, and
add-only immutability.

```bash
npx nullreg check --tags timescaledb,rds --domain software
```

- **Registry & spec:** https://github.com/therealcodyinman/nullregistry
- **Site & query index:** https://nullregistry.org · https://nullregistry.org/registry-index.json

Records are CC0; the spec and this tooling are Apache-2.0.
