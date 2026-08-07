// Minimal, dependency-free validator covering the JSON Schema subset used by
// NRS-0.1: type, required, properties, additionalProperties, enum, items,
// pattern, minLength, format:date-time (checked as ISO 8601 UTC).
//
// Ported verbatim from cli/lib/validate.js (CommonJS → ESM). The logic is
// runtime-agnostic and identical to the CLI's so a record that would pass a
// hand-authored PR passes the relay and vice versa. Kept byte-aligned by
// test/validate.test.js, which diffs this against the CLI copy.
export function validate(schema, value, path = '$') {
  const errors = [];
  const t = schema.type;
  const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  if (t && actual !== t) { errors.push(`${path}: expected ${t}, got ${actual}`); return errors; }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: value ${JSON.stringify(value)} not in enum [${schema.enum.join(', ')}]`);
  }
  if (t === 'string') {
    if (schema.minLength && value.length < schema.minLength) {
      errors.push(`${path}: shorter than minLength ${schema.minLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: does not match pattern ${schema.pattern}`);
    }
    if (schema.format === 'date-time' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) {
      errors.push(`${path}: not an ISO 8601 UTC date-time`);
    }
  }
  if (t === 'array' && schema.items) {
    value.forEach((v, i) => errors.push(...validate(schema.items, v, `${path}[${i}]`)));
  }
  if (t === 'object') {
    for (const req of schema.required || []) {
      if (!(req in value)) errors.push(`${path}: missing required property "${req}"`);
    }
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties && k in schema.properties) {
        errors.push(...validate(schema.properties[k], v, `${path}.${k}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}: additional property "${k}" not permitted`);
      }
    }
  }
  return errors;
}
