'use strict';
// Builds the static query index consumed by `nullreg check`.
// Usage: node build-index.js <output-file>
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const out = process.argv[2] || path.join(ROOT, '..', 'site', 'registry-index.json');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(dir, f));
}

const verifications = walk(path.join(ROOT, 'verifications')).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
const byTarget = {};
for (const v of verifications) {
  if (v.tombstone_version !== undefined) continue; // redacted verification: no target/verdict to tally
  byTarget[v.references] = byTarget[v.references] || { confirmed: 0, refuted: 0 };
  byTarget[v.references][v.verdict]++;
}

const records = walk(path.join(ROOT, 'records')).map((f) => {
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  // A tombstoned record keeps its id and place in the log but carries no content.
  if (r.tombstone_version !== undefined) {
    return { id: r.id, redacted: true, grounds: r.grounds };
  }
  return {
    id: r.id,
    domain: r.problem.fingerprint.domain,
    tags: r.problem.fingerprint.tags,
    problem: { statement: r.problem.statement },
    approach: { summary: r.approach.summary },
    failure: { mode: r.failure.mode, point: r.failure.point },
    transferability: r.transferability,
    confidence: r.confidence,
    verifications: byTarget[r.id] || { confirmed: 0, refuted: 0 },
    supersedes: (r.provenance && r.provenance.supersedes) || null,
  };
});

const index = {
  nrs_version: '0.1',
  generated: new Date().toISOString(),
  count: records.length,
  records,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(index, null, 2) + '\n');
console.log('Index written: ' + out + ' (' + records.length + ' records)');
