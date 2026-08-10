'use strict';
// Enforces the add-only registry rule with the single NRS-TS-0.1 carve-out
// (see spec/TOMBSTONE.md). Files under registry/records/ and
// registry/verifications/ may only be ADDED, except that an existing record or
// verification body MAY be replaced in place by a valid tombstone. Deleting any
// file, renaming, modifying a tombstone, or modifying a body into anything other
// than a valid tombstone is forbidden.
//
//   node registry/scripts/check-add-only.js <base-ref> <head-ref>
//
// Exit 0 = clean; 1 = at least one violation; 2 = usage error. See validate.yml.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const tombstone = require('../../cli/lib/tombstone.js');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'spec', 'schema', 'nrs-tombstone-0.1.schema.json');
const PUB_PATH = path.join(REPO_ROOT, 'spec', 'CHECKPOINT_KEY.pub');

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });
}

function showBytes(ref, file) {
  try { return git(['show', ref + ':' + file]); } catch { return null; }
}

function pinnedKey() {
  if (!fs.existsSync(PUB_PATH)) return null;
  const m = fs.readFileSync(PUB_PATH, 'utf8').match(/ed25519:[A-Za-z0-9_-]+/);
  return m ? m[0] : null;
}

function main() {
  const base = process.argv[2];
  const head = process.argv[3];
  if (!base || !head) { console.error('usage: check-add-only.js <base-ref> <head-ref>'); return 2; }

  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const key = pinnedKey();
  const out = git(['diff', '--name-status', base, head, '--', 'registry/records', 'registry/verifications'])
    .toString();
  const violations = [];

  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const status = parts[0];
    const file = parts[parts.length - 1]; // rename/copy: the last field is the new path

    if (status === 'A') continue; // additions always allowed; validate-all.js vets their content
    if (status[0] === 'D') { violations.push('deleted (forbidden): ' + file); continue; }
    if (status[0] !== 'M') { violations.push(status + ' (forbidden): ' + file); continue; }

    // A modification is permitted only as a body → valid-tombstone transition.
    const oldBytes = showBytes(base, file);
    let oldDoc = null;
    if (oldBytes) { try { oldDoc = JSON.parse(oldBytes.toString('utf8')); } catch { /* non-JSON old */ } }
    if (oldDoc && tombstone.isTombstone(oldDoc)) {
      violations.push('a tombstone is immutable and may not be modified: ' + file);
      continue;
    }

    const newBytes = showBytes(head, file);
    let newDoc = null;
    if (newBytes) { try { newDoc = JSON.parse(newBytes.toString('utf8')); } catch { /* non-JSON new */ } }
    if (!tombstone.isTombstone(newDoc)) {
      violations.push('a body may only be modified into a valid tombstone: ' + file);
      continue;
    }

    const expectedHash = path.basename(file).replace(/\.json$/, '');
    const errs = tombstone.validateTombstoneDoc(newDoc, { schema, pinnedKey: key, expectedHash });
    if (oldBytes) {
      const actual = crypto.createHash('sha256').update(oldBytes).digest('hex');
      if (newDoc.original_sha256 !== actual) {
        errs.push('original_sha256 does not match the removed file bytes (expected ' + actual + ')');
      }
    }
    if (oldDoc && typeof oldDoc.id === 'string' && oldDoc.id !== newDoc.id) {
      errs.push('tombstone id must preserve the original id (' + oldDoc.id + ')');
    }
    if (errs.length) violations.push('invalid tombstone: ' + file + '\n    ' + errs.join('\n    '));
  }

  if (violations.length) {
    console.error('Add-only violation(s) — registry files may only be added, or a body');
    console.error('replaced in place by a valid tombstone (spec/TOMBSTONE.md):');
    for (const v of violations) console.error('  ' + v);
    return 1;
  }
  console.log('Add-only check passed (tombstone carve-out honored).');
  return 0;
}

process.exit(main());
