'use strict';
// Validates every record and verification in the registry:
// schema conformance, content-hash id, filename==hash, Ed25519 signature,
// and supersedes target existence. Exit 1 on any failure.
const fs = require('node:fs');
const path = require('node:path');
const core = require('../../cli/lib/core.js');
const { validate } = require('../../cli/lib/validate.js');

const ROOT = path.join(__dirname, '..');
const recordSchema = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'spec', 'schema', 'nrs-0.1.schema.json'), 'utf8'));
const verifSchema = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'spec', 'schema', 'nrs-verification-0.1.schema.json'), 'utf8'));

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(dir, f));
}

let failures = 0;
const allIds = new Set();
const recordFiles = walk(path.join(ROOT, 'records'));
const verifFiles = walk(path.join(ROOT, 'verifications'));

for (const file of recordFiles) {
  const rel = path.relative(ROOT, file);
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    const errors = validate(recordSchema, record);
    const expectedId = core.computeId(record);
    if (record.id !== expectedId) errors.push('content hash mismatch (expected ' + expectedId + ')');
    const expectedName = expectedId.split(':')[2] + '.json';
    if (path.basename(file) !== expectedName) errors.push('filename must be ' + expectedName);
    const sig = core.verifyRecord(record);
    errors.push(...sig.errors.filter((e) => !e.startsWith('id mismatch')));
    if (errors.length) { failures++; console.error('FAIL ' + rel + '\n  ' + errors.join('\n  ')); }
    else { allIds.add(record.id); console.log('ok   ' + rel); }
  } catch (e) { failures++; console.error('FAIL ' + rel + '\n  ' + e.message); }
}

// Second pass: supersedes targets must exist.
for (const file of recordFiles) {
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (record.provenance && record.provenance.supersedes && !allIds.has(record.provenance.supersedes)) {
    failures++;
    console.error('FAIL ' + path.relative(ROOT, file) + '\n  supersedes target not found: ' + record.provenance.supersedes);
  }
}

for (const file of verifFiles) {
  const rel = path.relative(ROOT, file);
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    const errors = validate(verifSchema, v);
    const expectedId = core.computeVerificationId(v);
    if (v.id !== expectedId) errors.push('content hash mismatch (expected ' + expectedId + ')');
    const sig = core.verifyVerification(v);
    errors.push(...sig.errors.filter((e) => !e.startsWith('id mismatch')));
    if (!allIds.has(v.references)) errors.push('references unknown record: ' + v.references);
    if (errors.length) { failures++; console.error('FAIL ' + rel + '\n  ' + errors.join('\n  ')); }
    else console.log('ok   ' + rel);
  } catch (e) { failures++; console.error('FAIL ' + rel + '\n  ' + e.message); }
}

console.log('\n' + recordFiles.length + ' record(s), ' + verifFiles.length + ' verification(s), ' + failures + ' failure(s)');
process.exit(failures ? 1 : 0);
