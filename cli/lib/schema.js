'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Resolve an NRS schema by filename, preferring the packaged copy shipped in the
// npm tarball (cli/schema/) over the repo checkout (spec/schema/). The repo copy
// is canonical; cli/schema/ is a committed mirror kept in lockstep by a CI drift
// check (see validate.yml) so an installed package is self-contained.
function schemaPath(name) {
  const candidates = [
    path.join(__dirname, '..', 'schema', name),          // packaged: cli/schema/<name>
    path.join(__dirname, '..', '..', 'spec', 'schema', name), // repo checkout: spec/schema/<name>
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('NRS schema not found: ' + name);
}

function loadSchema(name) {
  return JSON.parse(fs.readFileSync(schemaPath(name), 'utf8'));
}

module.exports = { schemaPath, loadSchema };
