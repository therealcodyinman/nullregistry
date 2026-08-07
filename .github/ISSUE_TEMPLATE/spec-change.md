---
name: Spec change
about: Propose a change to NRS (the record/verification schema, canonicalization, or governance)
title: "Spec: …"
labels: [spec]
---

<!-- For changes to SPEC.md, the JSON Schemas, spec/CANONICALIZATION.md, or governance.
     For challenging a specific record, use "Dispute a record" instead. -->

## What part of the spec

<!-- e.g. nrs-0.1 schema field X, canonicalization rule Y, verification model, governance. Link the file/section. -->

## Problem

<!-- What is wrong, missing, ambiguous, or blocking today? Concrete example preferred. -->

## Proposed change

<!-- The change you propose, as precisely as you can state it. -->

## Compatibility impact

<!-- Does this break existing records, ids, or signatures? Canonicalization and id
     construction are frozen for a given nrs_version — changes that alter bytes over
     the canonical body require a new version (e.g. 0.2), not an edit to 0.1. -->

- [ ] Backward-compatible with existing 0.1 records and their ids/signatures.
- [ ] Requires a new `nrs_version`.
