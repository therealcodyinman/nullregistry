#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('../lib/core.js');
const { validate } = require('../lib/validate.js');

const SCHEMA_PATH = path.join(__dirname, '..', '..', 'spec', 'schema', 'nrs-0.1.schema.json');
const DEFAULT_INDEX_URL = 'https://nullregistry.org/registry-index.json';
const KEY_DIR = path.join(os.homedir(), '.nullreg');

function loadSchema() { return JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8')); }

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function cmdKeygen() {
  fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  const kp = core.generateKeypair();
  fs.writeFileSync(path.join(KEY_DIR, 'key.pem'), kp.privateKeyPem, { mode: 0o600 });
  fs.writeFileSync(path.join(KEY_DIR, 'key.pub.pem'), kp.publicKeyPem);
  fs.writeFileSync(path.join(KEY_DIR, 'identity'), kp.identity + '\n');
  console.log('Keypair written to ' + KEY_DIR);
  console.log('Identity: ' + kp.identity);
}

function renderRecord(r) {
  const lines = [
    r.id,
    '  problem:         ' + r.problem.statement,
    '  approach:        ' + r.approach.summary,
    '  failure:         [' + r.failure.mode + '] ' + r.failure.point,
    '  transferability: ' + r.transferability.scope + ' — ' + r.transferability.notes,
    '  confidence:      ' + r.confidence.level + (r.confidence.notes ? ' — ' + r.confidence.notes : ''),
  ];
  return lines.join('\n');
}

async function cmdCheck() {
  const tags = (arg('--tags') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const domain = arg('--domain');
  const indexUrl = arg('--index-url') || DEFAULT_INDEX_URL;
  const localIndex = arg('--index-file');
  let index;
  if (localIndex) {
    index = JSON.parse(fs.readFileSync(localIndex, 'utf8'));
  } else {
    const res = await fetch(indexUrl);
    if (!res.ok) { console.error('Index fetch failed: HTTP ' + res.status); process.exit(2); }
    index = await res.json();
  }
  const hits = index.records.filter((r) => {
    if (domain && r.domain !== domain) return false;
    if (tags.length && !tags.some((t) => r.tags.includes(t))) return false;
    return true;
  });
  if (!hits.length) { console.log('No matching null records.'); process.exit(1); }
  console.log(hits.length + ' matching null record(s):\n');
  for (const h of hits) console.log(renderRecord(h) + '\n');
}

async function cmdVerify(file) {
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  const schemaErrors = validate(loadSchema(), record);
  const sig = core.verifyRecord(record);
  const errors = [...schemaErrors, ...sig.errors];
  if (errors.length) { console.error('INVALID:\n  ' + errors.join('\n  ')); process.exit(1); }
  console.log('VALID ' + record.id);
}

async function cmdSubmit(file) {
  const repoRoot = arg('--repo') || process.cwd();
  const draft = JSON.parse(fs.readFileSync(file, 'utf8'));
  const identity = fs.readFileSync(path.join(KEY_DIR, 'identity'), 'utf8').trim();
  const privateKeyPem = fs.readFileSync(path.join(KEY_DIR, 'key.pem'), 'utf8');
  draft.provenance = draft.provenance || {};
  draft.provenance.author = draft.provenance.author || {};
  draft.provenance.author.identity = identity;
  delete draft.id;
  delete draft.provenance.signature;
  draft.id = core.computeId(draft);
  draft.provenance.signature = core.signRecord(draft, privateKeyPem);
  const schemaErrors = validate(loadSchema(), draft);
  if (schemaErrors.length) { console.error('Draft invalid:\n  ' + schemaErrors.join('\n  ')); process.exit(1); }
  const rel = path.join('registry', 'records', core.shardPath(draft.id));
  const dest = path.join(repoRoot, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(draft, null, 2) + '\n');
  console.log('Record written: ' + rel);
  console.log('Next: commit on a branch and open a PR:');
  console.log('  git checkout -b record/' + draft.id.slice(10, 22));
  console.log('  git add ' + rel + ' && git commit -m "record: ' + draft.problem.statement.slice(0, 60) + '"');
  console.log('  gh pr create --title "Null record: ' + draft.problem.statement.slice(0, 60) + '" --body "Submitted via nullreg"');
}

async function main() {
  const cmd = process.argv[2];
  try {
    if (cmd === 'keygen') await cmdKeygen();
    else if (cmd === 'check') await cmdCheck();
    else if (cmd === 'verify') await cmdVerify(process.argv[3]);
    else if (cmd === 'submit') await cmdSubmit(process.argv[3]);
    else {
      console.log('nullreg — client for the Null Registry (nullregistry.org)\n');
      console.log('  nullreg keygen                          generate an Ed25519 identity');
      console.log('  nullreg check --tags a,b [--domain d]   query the registry for dead ends');
      console.log('  nullreg submit <draft.json> [--repo p]  sign a draft and stage it for PR');
      console.log('  nullreg verify <record.json>            offline schema+hash+signature check');
      process.exit(cmd ? 2 : 0);
    }
  } catch (e) { console.error('Error: ' + e.message); process.exit(2); }
}
main();
