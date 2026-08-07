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
