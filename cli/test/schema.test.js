'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { schemaPath, loadSchema } = require('../lib/schema.js');

const NAMES = ['nrs-0.1.schema.json', 'nrs-verification-0.1.schema.json'];

test('schema resolves through the packaged path (cli/schema), not the repo path', () => {
  for (const name of NAMES) {
    const p = schemaPath(name);
    // The packaged copy under cli/schema/ must win over spec/schema/.
    assert.strictEqual(path.dirname(p), path.join(__dirname, '..', 'schema'),
      name + ' should resolve to cli/schema/');
    assert.strictEqual(path.basename(p), name);
  }
});

test('packaged schemas load as valid JSON Schema objects', () => {
  for (const name of NAMES) {
    const schema = loadSchema(name);
    assert.strictEqual(typeof schema, 'object');
    assert.strictEqual(schema.type, 'object');
    assert.ok(schema.properties && schema.required, name + ' looks like a schema');
  }
});

test('packaged schemas are byte-identical to the canonical spec copies', () => {
  for (const name of NAMES) {
    const packaged = fs.readFileSync(path.join(__dirname, '..', 'schema', name), 'utf8');
    const canonical = fs.readFileSync(path.join(__dirname, '..', '..', 'spec', 'schema', name), 'utf8');
    assert.strictEqual(packaged, canonical, name + ' drifted from spec/schema/');
  }
});
