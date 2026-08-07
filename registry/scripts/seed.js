'use strict';
// One-time seed: generates the nullregistry-seed identity, signs 10 null
// records drawn from publicly documented dead ends, writes them into
// records/. The seed private key is intentionally discarded after this run
// (see DECISIONS.md) — the identity can never author again, which caps its
// blast radius.
const fs = require('node:fs');
const path = require('node:path');
const core = require('../../cli/lib/core.js');
const { validate } = require('../../cli/lib/validate.js');

const ROOT = path.join(__dirname, '..');
if (fs.readdirSync(path.join(ROOT, 'records'), { recursive: true }).some((f) => String(f).endsWith('.json'))) {
  console.error('Registry already contains records; the seed is a one-time operation. Refusing to run.');
  process.exit(1);
}
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'spec', 'schema', 'nrs-0.1.schema.json'), 'utf8'));
const CREATED = '2026-08-06T18:30:00Z';

const drafts = [
  {
    problem: { statement: 'Run TimescaleDB with its full feature set (compression, continuous aggregates) on AWS RDS for PostgreSQL as the managed database for a multi-tenant SaaS.', fingerprint: { domain: 'software', tags: ['timescaledb', 'postgresql', 'aws', 'rds', 'licensing', 'time-series'] } },
    approach: { summary: 'Provision RDS PostgreSQL and enable the timescaledb extension, expecting managed-service hosting of TimescaleDB features.', detail: 'CREATE EXTENSION timescaledb on an RDS instance; alternatively sought TimescaleDB in the RDS supported-extension list.' },
    failure: { mode: 'external_constraint', point: 'TimescaleDB is not among the extensions RDS for PostgreSQL supports, and the features gated behind the Timescale License (compression, continuous aggregates) may not be offered by third-party DBaaS providers under that license.', evidence: 'AWS RDS PostgreSQL supported-extensions documentation omits timescaledb; Timescale License (TSL) section 2 restricts providing TSL features as a database-as-a-service. Self-hosting (e.g., on EC2) or Timescale Cloud are the documented paths.' },
    environment: { description: 'AWS RDS for PostgreSQL (any version as of 2026); constraint is contractual/platform, not version-specific.' },
    transferability: { scope: 'environment_bound', notes: 'Applies to RDS/Aurora and license-bound DBaaS generally. Does not apply to self-hosted deployments or the Apache-2.0 subset of TimescaleDB.' },
    confidence: { level: 'reproduced_once', notes: 'Vendor documentation on both sides states the constraint; independently hit in practice.' },
  },
  {
    problem: { statement: 'Use CPython threads to parallelize a CPU-bound workload for a wall-clock speedup.', fingerprint: { domain: 'software', tags: ['python', 'cpython', 'threading', 'gil', 'parallelism', 'performance'] } },
    approach: { summary: 'Split a pure-Python CPU-bound computation across threading.Thread workers expecting near-linear scaling.' },
    failure: { mode: 'performance', point: 'The Global Interpreter Lock allows only one thread to execute Python bytecode at a time; threaded CPU-bound code runs at or below single-thread speed.', evidence: 'CPython documentation (threading module) states threads are best for I/O-bound work and that CPU-bound parallelism requires multiprocessing or C extensions that release the GIL.' },
    environment: { description: 'CPython with the GIL enabled (all standard builds through 3.12; free-threaded builds are opt-in and experimental).' },
    transferability: { scope: 'environment_bound', notes: 'Does not transfer to multiprocessing, NumPy/C extensions releasing the GIL, PyPy-STM, or CPython free-threaded builds. Fully applies to standard CPython pure-Python workloads.' },
    confidence: { level: 'reproduced_once', notes: 'Extensively documented upstream; trivially reproducible.' },
  },
  {
    problem: { statement: 'Store emoji and other supplementary-plane characters in a MySQL column using the charset named utf8.', fingerprint: { domain: 'software', tags: ['mysql', 'unicode', 'utf8', 'utf8mb4', 'encoding'] } },
    approach: { summary: 'Insert 4-byte UTF-8 characters (emoji) into a column declared with MySQL charset utf8.' },
    failure: { mode: 'incorrect_result', point: 'MySQL utf8 is an alias for utf8mb3 (max 3 bytes per character); 4-byte characters are rejected or truncated with "Incorrect string value" errors.', evidence: 'MySQL reference manual documents utf8mb3 as a 3-byte-max encoding and directs users to utf8mb4 for full Unicode support.' },
    environment: { description: 'MySQL 5.x–8.x with charset utf8/utf8mb3 columns.' },
    transferability: { scope: 'universal', notes: 'Applies wherever the column charset is utf8mb3. Fix (utf8mb4) is universal; MySQL 8 deprecates utf8mb3.' },
    confidence: { level: 'reproduced_once', notes: 'Vendor-documented behavior.' },
  },
  {
    problem: { statement: 'Compare monetary or decimal quantities for equality using IEEE 754 binary floating point.', fingerprint: { domain: 'software', tags: ['floating-point', 'ieee754', 'money', 'equality', 'numerics'] } },
    approach: { summary: 'Represent currency as binary doubles and use exact equality checks (e.g., expecting 0.1 + 0.2 === 0.3).' },
    failure: { mode: 'incorrect_result', point: 'Decimal fractions like 0.1 have no exact binary representation; accumulated rounding makes exact equality unreliable (0.1 + 0.2 yields 0.30000000000000004).', evidence: 'IEEE 754 semantics as documented in every major language reference; canonical treatment in "What Every Computer Scientist Should Know About Floating-Point Arithmetic" (Goldberg, 1991).' },
    environment: { description: 'Any language using IEEE 754 binary64/binary32 (JavaScript Number, Python float, C double, C# double, etc.).' },
    transferability: { scope: 'universal', notes: 'Does not apply to decimal types (C# decimal, Java BigDecimal, Python decimal) or integer-cents representations — which are the standard fixes.' },
    confidence: { level: 'reproduced_once', notes: 'Foundational, universally reproducible.' },
  },
  {
    problem: { statement: 'Load an ESM-only npm package (e.g., chalk 5, node-fetch 3) from CommonJS code with require().', fingerprint: { domain: 'software', tags: ['nodejs', 'esm', 'commonjs', 'require', 'npm', 'modules'] } },
    approach: { summary: 'require("chalk") after upgrading to a major version that ships as pure ESM.' },
    failure: { mode: 'external_constraint', point: 'Packages declaring "type": "module" without a CJS export cannot be require()d on Node < 22.12/20.17-era interop; the call throws ERR_REQUIRE_ESM.', evidence: 'Node.js documentation of ERR_REQUIRE_ESM and the affected packages\' own migration notes; workarounds are dynamic import(), staying on the last CJS major, or new-enough Node with require(esm) enabled.' },
    environment: { description: 'Node.js versions predating stable require(esm) support (roughly < 22.12 / < 23), CommonJS consumer.' },
    transferability: { scope: 'environment_bound', notes: 'Recent Node versions can require() synchronous-graph ESM; check your runtime before treating this as a wall.' },
    confidence: { level: 'reproduced_once', notes: 'Documented and version-dependent; see transferability.' },
  },
  {
    problem: { statement: 'Accept and hash passwords longer than 72 bytes with bcrypt and have the full input contribute to the digest.', fingerprint: { domain: 'software', tags: ['bcrypt', 'password-hashing', 'security', 'truncation', 'authentication'] } },
    approach: { summary: 'Pass arbitrarily long passphrases directly to bcrypt, assuming the whole string is hashed.' },
    failure: { mode: 'incorrect_result', point: 'bcrypt derives from the Blowfish key schedule and uses at most 72 bytes of input; most implementations silently truncate, so passwords sharing a 72-byte prefix verify as equal.', evidence: 'Documented in major bcrypt implementations (OpenBSD origin, py-bcrypt, bcrypt npm) and OWASP Password Storage guidance, which recommends pre-hashing or another KDF for long inputs.' },
    environment: { description: 'Any standard bcrypt implementation.' },
    transferability: { scope: 'universal', notes: 'Intrinsic to bcrypt. Does not apply to Argon2 or scrypt. Note: pre-hashing with raw SHA-256 introduces its own NUL-byte pitfalls — encode before pre-hashing.' },
    confidence: { level: 'reproduced_once', notes: 'Documented across implementations.' },
  },
  {
    problem: { statement: 'Serve a leading-wildcard substring search (LIKE \'%term%\') at scale on PostgreSQL using an ordinary b-tree index.', fingerprint: { domain: 'software', tags: ['postgresql', 'indexing', 'btree', 'like', 'full-text-search', 'performance'] } },
    approach: { summary: 'Create a standard b-tree index on the text column and query with LIKE bracketed by wildcards, expecting index scans.' },
    failure: { mode: 'performance', point: 'B-tree indexes match only left-anchored patterns; a leading % forces a sequential scan regardless of the index.', evidence: 'PostgreSQL documentation on index types and operator classes; the documented fix is pg_trgm GIN/GiST indexes or full-text search.' },
    environment: { description: 'PostgreSQL (all supported versions).' },
    transferability: { scope: 'universal', notes: 'Property of b-tree ordering, so it applies across databases. Trigram/FTS solutions are engine-specific.' },
    confidence: { level: 'reproduced_once', notes: 'Documented and easily shown with EXPLAIN.' },
  },
  {
    problem: { statement: 'Use SQLite as the shared database for multiple concurrent writers over an NFS-mounted filesystem.', fingerprint: { domain: 'software', tags: ['sqlite', 'nfs', 'file-locking', 'concurrency', 'corruption'] } },
    approach: { summary: 'Point several processes on different hosts at one SQLite file on an NFS share and rely on SQLite locking for safety.' },
    failure: { mode: 'instability', point: 'SQLite depends on correct POSIX advisory locking, which many NFS implementations get wrong; the result is intermittent SQLITE_BUSY storms and, in the worst case, database corruption.', evidence: 'SQLite official documentation ("How To Corrupt An SQLite Database File" and the FAQ) explicitly warns against NFS for concurrent access and recommends a client/server database for networked multi-writer workloads.' },
    environment: { description: 'SQLite on NFS-mounted volumes with multiple writers; severity varies by NFS server/client implementation.' },
    transferability: { scope: 'environment_bound', notes: 'Single-writer or local-disk SQLite is unaffected. Some modern NFSv4 stacks lock correctly, but the vendor guidance is to not rely on it.' },
    confidence: { level: 'reproduced_once', notes: 'Vendor-documented hazard.' },
  },
  {
    problem: { statement: 'Parse non-ISO-8601 date strings with the JavaScript Date constructor and get consistent results across engines.', fingerprint: { domain: 'software', tags: ['javascript', 'date', 'parsing', 'ecmascript', 'cross-browser'] } },
    approach: { summary: 'Feed human-formatted strings (e.g., "March 5, 2024", "2024-3-5", "5/3/2024") to new Date() / Date.parse and rely on the output.' },
    failure: { mode: 'incorrect_result', point: 'ECMAScript only specifies parsing for the ISO 8601 profile; everything else is implementation-defined, so identical inputs yield different dates, timezones, or Invalid Date across engines.', evidence: 'ECMAScript specification (Date.parse) states non-conforming formats fall back to implementation-specific heuristics; MDN documents the resulting cross-browser inconsistencies and recommends against it.' },
    environment: { description: 'All JavaScript engines; divergence is between engines rather than within one.' },
    transferability: { scope: 'universal', notes: 'ISO 8601 strings and explicit parsing libraries (Temporal, date-fns, Luxon) are unaffected — that is the fix.' },
    confidence: { level: 'reproduced_once', notes: 'Specified-as-unspecified; documented divergence.' },
  },
  {
    problem: { statement: 'Persist state from a sandboxed third-party iframe embed using localStorage.', fingerprint: { domain: 'software', tags: ['browser', 'iframe', 'sandbox', 'localstorage', 'embed', 'storage-partitioning'] } },
    approach: { summary: 'Call window.localStorage inside an iframe sandboxed without allow-same-origin, or rely on third-party iframe storage surviving across sites.' },
    failure: { mode: 'external_constraint', point: 'A sandboxed frame without allow-same-origin has an opaque origin, so localStorage access throws SecurityError; even with access, modern browsers partition third-party storage per top-level site, so state does not carry across embedding sites.', evidence: 'HTML specification on sandboxing and opaque origins; MDN Web Storage documentation; browser storage-partitioning rollouts documented by Chrome, Firefox, and Safari (ITP).' },
    environment: { description: 'Current evergreen browsers embedding cross-origin or sandboxed iframes.' },
    transferability: { scope: 'environment_bound', notes: 'First-party same-origin frames are unaffected. Server-side state or postMessage to the host page are the standard routes for embeds.' },
    confidence: { level: 'reproduced_once', notes: 'Spec-defined behavior plus documented browser policy.' },
  },
];

// --- sign and write ---------------------------------------------------------
const kp = core.generateKeypair();
console.log('Seed identity: ' + kp.identity);
let failures = 0;
for (const d of drafts) {
  const record = {
    nrs_version: '0.1',
    created: CREATED,
    ...d,
    provenance: { author: { type: 'mixed', identity: kp.identity, model: 'claude (nullregistry architect) + human executor' } },
  };
  record.id = core.computeId(record);
  record.provenance.signature = core.signRecord(record, kp.privateKeyPem);
  const errors = validate(schema, record);
  const check = core.verifyRecord(record);
  if (errors.length || !check.ok) {
    failures++;
    console.error('SEED INVALID: ' + d.problem.statement.slice(0, 50));
    console.error('  ' + [...errors, ...check.errors].join('\n  '));
    continue;
  }
  const dest = path.join(ROOT, 'records', core.shardPath(record.id));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(record, null, 2) + '\n');
  console.log('wrote ' + path.relative(ROOT, dest));
}
console.log(failures ? failures + ' failure(s)' : 'All seeds written. Private key discarded with this process.');
process.exit(failures ? 1 : 0);
