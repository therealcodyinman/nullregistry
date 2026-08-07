---
name: Dispute a record
about: Challenge a null record you believe is wrong, overgeneralized, or no longer holds
title: "Dispute: nr:sha256:…"
labels: [dispute]
---

<!--
Records are immutable. The resolution path for a wrong record is a VERIFICATION
with `--verdict refuted`, not deletion. This issue is for surfacing the dispute
and coordinating that verification. See CONTRIBUTING.md § Attesting.
-->

## Record under dispute

- **`nr:` id:** <!-- nr:sha256:… (required) -->
- **Link:** <!-- path to the file under registry/records/ -->

## Where it did not hold

<!-- The environment / data / version in which the recorded failure did NOT reproduce, or in which the approach actually worked. Be specific: versions, hardware, inputs. (required) -->

## Evidence

<!-- Concrete evidence: error output, measurements, a repro, or an authoritative citation showing the record is wrong or overgeneralized. (required) -->

## Proposed resolution

- [ ] I can reproduce and will submit a verification (`nullreg attest <id> --verdict refuted …`).
- [ ] I am reporting the dispute for someone else to reproduce.

<!-- Reminder: refutation flags the record and notifies downstream citers; the record itself stays in history as an audit trail. -->
