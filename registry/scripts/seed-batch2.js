'use strict';
// Second seed batch: 20 additional null records drawn from publicly documented
// dead ends, bringing the corpus to 30. Modeled on seed.js. A fresh single-use
// Ed25519 identity signs this batch and its private key is discarded when the
// process exits (see DECISIONS.md) — the identity can never author again.
//
// Guard: this is a one-time batch, like seed.js. Each run mints a fresh
// single-use identity, so the content-addressed ids (which include the author
// identity) differ every run — file-existence cannot make it idempotent.
// Instead it refuses unless exactly the 10 founding seed records are present,
// which is the only state in which appending this batch is correct.
const fs = require('node:fs');
const path = require('node:path');
const core = require('../../cli/lib/core.js');
const { validate } = require('../../cli/lib/validate.js');

const ROOT = path.join(__dirname, '..');
const SEED_COUNT = 10; // the founding seed (see seed.js); this batch appends to it.

function countRecords() {
  const dir = path.join(ROOT, 'records');
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.json')).length;
}
const existing = countRecords();
if (existing !== SEED_COUNT) {
  console.error('Refusing to run: expected exactly the ' + SEED_COUNT + ' founding seed records as the precondition, found ' + existing + '.');
  console.error(existing > SEED_COUNT ? 'Batch 2 appears already applied.' : 'Run registry/scripts/seed.js first.');
  process.exit(1);
}

const schema = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'spec', 'schema', 'nrs-0.1.schema.json'), 'utf8'));
// Uniform authoring timestamp = this batch's build time (see DECISIONS.md #8/#20).
const CREATED = '2026-08-07T16:00:00Z';

const drafts = [
  // --- software ------------------------------------------------------------
  {
    problem: { statement: 'Keep large, frequently-changing binary assets (video, datasets, build outputs) directly in a normal Git repository and expect the clone size to stay proportional to the current checkout.', fingerprint: { domain: 'software', tags: ['git', 'version-control', 'binary-assets', 'repository-bloat', 'git-lfs'] } },
    approach: { summary: 'Commit large binaries directly across revisions; later delete them in a new commit expecting the repository to shrink.', detail: 'git add large.bin over many commits; on bloat, git rm the files assuming history reclaims the space.' },
    failure: { mode: 'resource_exhaustion', point: 'Every version of every blob is retained in history permanently; deleting a file in a later commit leaves all prior copies in the packfile, so clone size never drops without rewriting history.', evidence: 'Pro Git (Git Internals — packfiles; "Removing Objects") and the Git LFS documentation state that purging large blobs requires rewriting history with git filter-repo/filter-branch and force-pushing, invalidating every downstream clone.' },
    environment: { description: 'Any Git version; severity grows with blob size and churn.' },
    transferability: { scope: 'universal', notes: "Intrinsic to Git's content-addressed, append-only object model. Does not apply when large assets are kept in Git LFS or an external object store from the start." },
    confidence: { level: 'reproduced_once', notes: "Documented behavior of Git's object model; readily shown with git count-objects -v before and after." },
  },
  {
    problem: { statement: 'Get reproducible, pinned container deployments by referencing images with the :latest tag in build and deploy manifests.', fingerprint: { domain: 'software', tags: ['docker', 'containers', 'latest-tag', 'reproducibility', 'oci'] } },
    approach: { summary: 'Reference FROM image:latest and deploy image:latest, expecting the same bits on every pull.' },
    failure: { mode: 'incorrect_result', point: ':latest is a mutable, non-versioned tag that points at whatever was pushed last; two pulls at different times can resolve to different images, so builds and rollbacks are not reproducible.', evidence: 'Docker documentation notes latest is merely the default tag with no guarantee of being newest or stable; reproducibility guidance is to pin by immutable digest (image@sha256:...).' },
    environment: { description: 'Docker/OCI registries; any orchestrator that pulls by tag.' },
    transferability: { scope: 'universal', notes: 'Applies to any mutable tag, not only latest. Pinning by digest (image@sha256:…) removes the problem entirely.' },
    confidence: { level: 'reproduced_once', notes: 'Registry tag mutability is documented and trivially observable.' },
  },
  {
    problem: { statement: 'Assume that one application-level send over a TCP socket arrives as exactly one recv on the peer, preserving message boundaries.', fingerprint: { domain: 'software', tags: ['tcp', 'sockets', 'networking', 'framing', 'byte-stream'] } },
    approach: { summary: 'Design a wire protocol that reads one logical message per recv() call, relying on send/recv to align with message boundaries.' },
    failure: { mode: 'incorrect_result', point: 'TCP is a byte stream with no message boundaries; a single send may be split across multiple recvs or coalesced with others, so a reader that assumes one-send-one-recv desynchronizes.', evidence: "Berkeley/POSIX sockets semantics and long-standing references (e.g., Beej's Guide to Network Programming) state TCP does not preserve message boundaries; explicit length-prefix or delimiter framing is required." },
    environment: { description: 'Any TCP implementation.' },
    transferability: { scope: 'universal', notes: 'Message-oriented transports (UDP datagrams, SCTP, WebSocket frames) preserve boundaries and are unaffected; for TCP the fix is explicit framing.' },
    confidence: { level: 'reproduced_once', notes: 'Foundational, documented transport behavior.' },
  },
  {
    problem: { statement: 'Sort an array of numbers into ascending numeric order by calling Array.prototype.sort() with no comparator in JavaScript.', fingerprint: { domain: 'software', tags: ['javascript', 'array-sort', 'comparator', 'numeric-sort', 'ecmascript'] } },
    approach: { summary: 'Call [1, 2, 10, 21].sort() and expect ascending numeric order.' },
    failure: { mode: 'incorrect_result', point: 'With no comparator, sort() converts elements to strings and orders them by UTF-16 code unit, so 10 sorts before 2, yielding [1, 10, 2, 21].', evidence: 'The ECMAScript specification (Array.prototype.sort) and MDN document the default lexicographic string comparison; numeric order requires an explicit comparator (a, b) => a - b.' },
    environment: { description: 'All ECMAScript engines.' },
    transferability: { scope: 'universal', notes: 'Specified across engines. An explicit numeric comparator fixes it. Does not apply to TypedArray.prototype.sort, which is numeric by default.' },
    confidence: { level: 'reproduced_once', notes: 'Spec-defined; trivially reproducible.' },
  },
  {
    problem: { statement: 'Serve concurrent requests while performing a long synchronous CPU-bound computation inside a Node.js request handler, expecting other requests to proceed.', fingerprint: { domain: 'software', tags: ['nodejs', 'event-loop', 'concurrency', 'blocking', 'performance'] } },
    approach: { summary: 'Run a heavy synchronous loop (or synchronous crypto/JSON on huge input) directly in the request handler.' },
    failure: { mode: 'performance', point: 'Node runs JavaScript on a single event-loop thread; a synchronous CPU-bound task blocks the loop, stalling all other connections and timers until it finishes.', evidence: 'Node.js documentation ("Don\'t Block the Event Loop (or the Worker Pool)") states long synchronous work starves concurrency and directs offloading to worker_threads, child processes, or chunking the work.' },
    environment: { description: 'Node.js (all versions); single main event-loop thread.' },
    transferability: { scope: 'universal', notes: 'Applies to work on the main thread. worker_threads, clustering, or native addons using the libuv pool avoid it; async I/O-bound work is unaffected.' },
    confidence: { level: 'reproduced_once', notes: 'Documented single-threaded model; reproducible with a blocking loop and a concurrent client.' },
  },
  {
    problem: { statement: 'Update React component state by mutating the existing state object or array in place and expect the component to re-render with the change.', fingerprint: { domain: 'software', tags: ['react', 'state', 'immutability', 'rerender', 'hooks'] } },
    approach: { summary: 'Do state.items.push(x) or state.count++ then call setState(state) / setCount(count) with the same reference.' },
    failure: { mode: 'incorrect_result', point: 'React decides whether to re-render by comparing references (Object.is); mutating in place keeps the same reference, so updates are skipped or applied inconsistently.', evidence: 'React documentation ("Updating Objects in State", "Keeping Components Pure") requires treating state as immutable and passing new objects/arrays; in-place mutation is called out as a defect source.' },
    environment: { description: 'React (function or class components) using reference-equality bailout.' },
    transferability: { scope: 'universal', notes: "Applies to React's rendering model. Libraries built on mutation (MobX, Immer drafts) intentionally opt out; plain useState/useReducer require new references." },
    confidence: { level: 'reproduced_once', notes: 'Documented rendering semantics.' },
  },
  {
    problem: { statement: 'Iterate safely over files, including names with spaces or newlines, by writing `for f in $(ls)` in a shell script.', fingerprint: { domain: 'software', tags: ['bash', 'shell', 'word-splitting', 'globbing', 'filenames'] } },
    approach: { summary: 'Loop with for f in $(ls) (or $(ls *.txt)) and process each $f.' },
    failure: { mode: 'incorrect_result', point: 'Command substitution undergoes word-splitting and globbing, so filenames containing spaces, tabs, newlines, or glob characters are split apart or expanded incorrectly.', evidence: "Documented in the shell pitfalls references (BashFAQ 001, Greg's Wiki ParsingLs) and flagged by ShellCheck (SC2045); the recommended forms are a glob loop `for f in ./*` or `find … -print0 | while IFS= read -r -d '' f`." },
    environment: { description: 'POSIX shells / Bash.' },
    transferability: { scope: 'universal', notes: 'Applies wherever word-splitting is in effect. A globbing for-loop or NUL-delimited find avoids it; tightly controlled filenames may hide the bug without fixing it.' },
    confidence: { level: 'reproduced_once', notes: 'Well-documented shell pitfall.' },
  },
  {
    problem: { statement: 'Use random UUIDv4 values as the clustered primary key of a large, insert-heavy table (InnoDB or SQL Server) and expect insert performance comparable to sequential keys.', fingerprint: { domain: 'software', tags: ['database', 'uuid', 'clustered-index', 'innodb', 'fragmentation'] } },
    approach: { summary: 'Make a random UUID the clustered PRIMARY KEY and bulk-insert rows.' },
    failure: { mode: 'performance', point: 'Random keys scatter inserts across the clustered B-tree, causing page splits, low fill factor, and buffer-pool thrash; throughput and index locality degrade sharply versus monotonic keys.', evidence: 'MySQL/InnoDB documentation recommends an ever-increasing primary key for clustered tables; vendor and practitioner writeups on UUID fragmentation motivate time-ordered UUIDv7/ULID or auto-increment surrogates.' },
    environment: { description: 'InnoDB (MySQL) and SQL Server clustered indexes; effect grows with table size.' },
    transferability: { scope: 'environment_bound', notes: 'Applies to engines that physically order rows by the primary key. Heap-organized tables (default PostgreSQL) are far less affected; time-ordered UUIDv7/ULID largely fixes it.' },
    confidence: { level: 'reproduced_once', notes: 'Documented index-organization behavior; widely reproduced.' },
  },
  {
    problem: { statement: "Securely verify a JSON Web Token by trusting the signing algorithm named in the token's own header (the alg field).", fingerprint: { domain: 'software', tags: ['jwt', 'authentication', 'security', 'algorithm-confusion', 'alg-none'] } },
    approach: { summary: 'Call a verify routine that reads alg from the JWT header to decide how to check the signature.' },
    failure: { mode: 'incorrect_result', point: 'The attacker controls the header: alg:none skips verification entirely, and downgrading an RS256 token to HS256 makes the library verify an attacker-forged HMAC using the public key as the secret — both accept forged tokens.', evidence: 'RFC 8725 (JSON Web Token Best Current Practices) documents the "none" and algorithm-substitution attacks and requires verifiers to pin expected algorithms rather than trust the header.' },
    environment: { description: 'JWT libraries that select the verification algorithm from the token header; multiple historical CVEs.' },
    transferability: { scope: 'universal', notes: 'Applies to any verifier that trusts the header alg. Pinning the algorithm and key type server-side eliminates it. This records the failed approach, not an exploit recipe.' },
    confidence: { level: 'reproduced_once', notes: 'Documented in the JWT BCP and numerous library advisories.' },
  },
  {
    problem: { statement: 'Allow a browser to send credentialed cross-origin requests (cookies or Authorization headers) by responding with Access-Control-Allow-Origin: *.', fingerprint: { domain: 'software', tags: ['cors', 'browser', 'http', 'credentials', 'fetch'] } },
    approach: { summary: 'Set Access-Control-Allow-Origin: * and expect credentialed fetch/XHR requests to succeed.' },
    failure: { mode: 'external_constraint', point: "The Fetch standard forbids the wildcard origin for credentialed requests; the browser blocks the response unless the server echoes the specific request Origin and sends Access-Control-Allow-Credentials: true.", evidence: 'The WHATWG Fetch specification (CORS protocol) and MDN document that "*" is invalid with credentials; the server must reflect the exact Origin and set Allow-Credentials: true.' },
    environment: { description: 'Evergreen browsers enforcing the Fetch/CORS protocol.' },
    transferability: { scope: 'environment_bound', notes: 'Enforced by browsers, not by the server or non-browser clients (curl, server-to-server). Non-credentialed requests may use "*" freely.' },
    confidence: { level: 'reproduced_once', notes: 'Spec-defined browser behavior.' },
  },

  // --- ml ------------------------------------------------------------------
  {
    problem: { statement: 'Preprocess a dataset by fitting a scaler, imputer, or feature selector on all rows before splitting into train and test, then evaluate on the held-out test set.', fingerprint: { domain: 'ml', tags: ['machine-learning', 'data-leakage', 'preprocessing', 'cross-validation', 'scikit-learn'] } },
    approach: { summary: 'Fit the transformer on the full dataset, then split into train/test and report test-set metrics.' },
    failure: { mode: 'incorrect_result', point: 'Statistics learned during preprocessing (means, variances, feature rankings) incorporate test-set information, leaking it into training and producing optimistically biased evaluation that does not generalize.', evidence: 'scikit-learn documentation ("Common pitfalls and recommended practices" — Data leakage) instructs fitting all transformers inside a Pipeline on the training split only (e.g., within cross-validation) to prevent this.' },
    environment: { description: 'Supervised ML with any fitted preprocessing step; framework-independent.' },
    transferability: { scope: 'universal', notes: 'Applies to any transform that learns parameters from data. Stateless transforms (fixed unit conversions) do not leak; the fix is fitting within the training fold via a Pipeline.' },
    confidence: { level: 'reproduced_once', notes: 'Documented pitfall; reproducible as an inflated test score that collapses under proper splitting.' },
  },
  {
    problem: { statement: 'Judge a classifier on a highly imbalanced dataset (for example 99% negatives) using overall accuracy as the primary evaluation metric.', fingerprint: { domain: 'ml', tags: ['machine-learning', 'imbalanced-data', 'accuracy', 'metrics', 'evaluation'] } },
    approach: { summary: 'Report overall accuracy and treat a high number as evidence of a good model.' },
    failure: { mode: 'incorrect_result', point: 'A trivial classifier that always predicts the majority class scores ~99% accuracy while detecting none of the minority class, so accuracy conceals total failure on the class that matters.', evidence: 'scikit-learn documentation and standard references recommend precision/recall, F1, balanced accuracy, ROC-AUC, or PR-AUC for imbalanced problems; the "accuracy paradox" is widely documented.' },
    environment: { description: 'Any classification task with skewed class priors.' },
    transferability: { scope: 'universal', notes: 'Applies whenever class priors or costs are imbalanced. For balanced data with equal error costs, accuracy is a reasonable metric.' },
    confidence: { level: 'reproduced_once', notes: 'Well-documented; reproducible with a majority-class baseline.' },
  },
  {
    problem: { statement: 'Run inference or validation with a PyTorch model containing Dropout or BatchNorm without switching it out of training mode first.', fingerprint: { domain: 'ml', tags: ['machine-learning', 'pytorch', 'model-eval', 'dropout', 'batchnorm'] } },
    approach: { summary: 'Call the model on validation/test inputs while it is still in train() mode (no model.eval()).' },
    failure: { mode: 'incorrect_result', point: 'In training mode Dropout randomly zeros activations and BatchNorm uses per-batch statistics rather than running estimates, so predictions become non-deterministic and inconsistent with deployment.', evidence: 'PyTorch documentation (nn.Module.eval / train, Dropout, BatchNorm) states eval() disables dropout and switches BatchNorm to running statistics; it must be set before inference and train() restored for training.' },
    environment: { description: 'PyTorch models containing training-mode-sensitive layers.' },
    transferability: { scope: 'universal', notes: 'Applies only to models with mode-dependent layers (Dropout, BatchNorm, etc.); models without them are unaffected. torch.no_grad() is a separate concern also recommended for inference.' },
    confidence: { level: 'reproduced_once', notes: 'Documented layer behavior; reproducible as varying predictions on identical input.' },
  },
  {
    problem: { statement: 'Tune hyperparameters and select models by repeatedly evaluating candidates on the same held-out test set, then report that test score as the final estimate of generalization.', fingerprint: { domain: 'ml', tags: ['machine-learning', 'model-selection', 'test-set', 'overfitting', 'validation'] } },
    approach: { summary: 'Use the test set as the selection signal across many trials and quote its score as the final result.' },
    failure: { mode: 'incorrect_result', point: 'Each decision made using the test set leaks information about it; across many trials the reported score adapts to that particular set and overstates true generalization.', evidence: 'Standard ML methodology (scikit-learn "Cross-validation" guidance; the adaptive-data-analysis literature, e.g. Dwork et al., 2015) prescribes a separate validation set or nested cross-validation for selection, leaving the test set untouched until the end.' },
    environment: { description: 'Any supervised model-selection workflow.' },
    transferability: { scope: 'universal', notes: 'Applies whenever the same data drives both selection and final evaluation. A test set used exactly once, or nested CV, avoids it.' },
    confidence: { level: 'single_attempt', notes: 'Methodological failure; the bias is statistical and grows with the number of selection trials rather than being a single deterministic error.' },
  },

  // --- ops -----------------------------------------------------------------
  {
    problem: { statement: 'Build a distributed system on the assumption that remote calls between services always succeed (the network is reliable), omitting timeouts, retries, and failure handling.', fingerprint: { domain: 'ops', tags: ['distributed-systems', 'fallacies', 'reliability', 'rpc', 'resilience'] } },
    approach: { summary: 'Treat RPC/HTTP calls as if they were local in-process function calls that cannot fail or hang.' },
    failure: { mode: 'external_constraint', point: 'Networks drop, delay, duplicate, reorder, and partition; calls that assume reliability hang on unbounded waits and cascade failures under real conditions.', evidence: 'The "Fallacies of Distributed Computing" (Deutsch and Gosling; expanded by Rotem-Gal-Oz) list "the network is reliable" as the first fallacy; resilience guidance mandates timeouts, retries with backoff, and circuit breakers.' },
    environment: { description: 'Any networked or distributed architecture.' },
    transferability: { scope: 'universal', notes: 'Applies to all inter-process network communication. Genuinely in-process, single-node calls are exempt; more nodes and hops sharpen the failure.' },
    confidence: { level: 'single_attempt', notes: 'Codified industry principle; the failure manifests probabilistically under load and partitions rather than deterministically.' },
  },
  {
    problem: { statement: 'Recover from transient failures of a shared downstream service by having all clients immediately retry failed requests in a tight loop, without backoff or jitter.', fingerprint: { domain: 'ops', tags: ['distributed-systems', 'retries', 'backoff', 'jitter', 'thundering-herd'] } },
    approach: { summary: 'On error, retry right away with fixed or no delay, with every client doing the same.' },
    failure: { mode: 'instability', point: 'Synchronized immediate retries multiply load on an already-struggling dependency, creating a thundering herd / retry storm that prevents recovery and can drive congestion collapse.', evidence: 'The AWS Builders\' Library ("Timeouts, retries, and backoff with jitter") and the classic backoff literature show exponential backoff with randomized jitter is required to de-correlate retries and let a dependency recover.' },
    environment: { description: 'Any client fleet retrying against a shared service.' },
    transferability: { scope: 'universal', notes: 'Applies to concurrent clients sharing a dependency. A single low-frequency client retrying is largely harmless; the fix is capped exponential backoff with jitter plus a retry budget.' },
    confidence: { level: 'reproduced_once', notes: 'Documented failure mode with an established remedy.' },
  },
  {
    problem: { statement: 'Increase throughput on an existing keyed Kafka topic by adding partitions, while preserving per-key message ordering.', fingerprint: { domain: 'ops', tags: ['kafka', 'partitioning', 'ordering', 'streaming', 'messaging'] } },
    approach: { summary: "Raise a topic's partition count and expect messages sharing a key to keep landing on one partition in order." },
    failure: { mode: 'incorrect_result', point: 'Kafka guarantees ordering only within a partition, and default key placement is hash(key) mod numPartitions; changing the partition count remaps existing keys, so a key\'s messages split across old and new partitions and lose order.', evidence: 'Apache Kafka documentation states ordering is per-partition and that adding partitions changes key-to-partition assignment; the guidance is to over-provision partitions up front or use a stable custom partitioner.' },
    environment: { description: 'Apache Kafka topics relying on key-based ordering.' },
    transferability: { scope: 'environment_bound', notes: 'Applies to keyed topics that depend on ordering. Topics without ordering requirements, or with partition count fixed from the start, are unaffected.' },
    confidence: { level: 'reproduced_once', notes: 'Documented partitioning semantics.' },
  },

  // --- math ----------------------------------------------------------------
  {
    problem: { statement: 'Trisect an arbitrary given angle using only an unmarked straightedge and compass in a finite number of steps.', fingerprint: { domain: 'math', tags: ['geometry', 'compass-and-straightedge', 'constructibility', 'trisection', 'impossibility'] } },
    approach: { summary: 'Search for a finite compass-and-straightedge construction that divides any given angle into three equal parts.' },
    failure: { mode: 'dead_end_reasoning', point: 'Trisecting a general angle (e.g. 60°) requires solving an irreducible cubic, producing a number of degree 3 over the rationals, which is not constructible because constructible numbers have degree a power of 2.', evidence: 'Proven impossible by Pierre Wantzel (1837) using field theory; a standard result in abstract algebra (constructible numbers lie in a tower of quadratic extensions).' },
    environment: { description: 'Classical Euclidean construction with an unmarked straightedge and compass.' },
    transferability: { scope: 'universal', notes: 'The impossibility is for a general angle with the classical tools only. Specific angles (90°, 45°) are trisectable, and relaxing the tools (marked ruler/neusis, origami) makes trisection possible.' },
    confidence: { level: 'reproduced_once', notes: 'Settled theorem (Wantzel, 1837); the "reproduction" is the proof, not an experiment.' },
  },
  {
    problem: { statement: 'Find a general algebraic formula in radicals that solves every quintic (degree-5) polynomial equation, the way the quadratic formula solves degree 2.', fingerprint: { domain: 'math', tags: ['algebra', 'galois-theory', 'quintic', 'solvability-by-radicals', 'impossibility'] } },
    approach: { summary: 'Seek a closed-form radical expression for the roots of the general fifth-degree polynomial.' },
    failure: { mode: 'dead_end_reasoning', point: "The general quintic's Galois group is the symmetric group S5, which is not solvable; solvability by radicals requires a solvable Galois group, so no such general formula exists.", evidence: 'Abel–Ruffini theorem (Ruffini 1799; Abel 1824), explained by Galois theory; a standard graduate-algebra result.' },
    environment: { description: 'General polynomials of degree ≥ 5 over the rationals.' },
    transferability: { scope: 'universal', notes: 'Applies to a general radical formula for degree ≥ 5. Particular quintics with solvable Galois groups are solvable by radicals, and numerical or elliptic methods solve any quintic — just not by radicals in general.' },
    confidence: { level: 'reproduced_once', notes: 'Settled theorem (Abel–Ruffini); proof, not experiment.' },
  },
  {
    problem: { statement: 'Match arbitrarily deep balanced or nested delimiters (parentheses, or well-formed HTML) using a classical regular expression.', fingerprint: { domain: 'math', tags: ['formal-languages', 'regular-expressions', 'pumping-lemma', 'context-free', 'parsing'] } },
    approach: { summary: 'Write a true regular expression (no recursion or balancing extensions) that validates arbitrarily nested balanced brackets.' },
    failure: { mode: 'dead_end_reasoning', point: 'The language of balanced parentheses is context-free but not regular; a finite automaton cannot count unbounded nesting depth, as shown by the pumping lemma for regular languages.', evidence: "Standard formal-language theory (the pumping lemma; Sipser, Introduction to the Theory of Computation) proves balanced-bracket and HTML languages are non-regular. Modern regex engines match them only via non-regular recursion or balancing-group extensions." },
    environment: { description: 'Classical regular expressions / finite automata, without recursive or balancing extensions.' },
    transferability: { scope: 'universal', notes: 'Applies to genuinely regular expressions. Engines with recursion (PCRE (?R)) or .NET balancing groups exceed regular power and can match balanced input; a real parser is the standard tool.' },
    confidence: { level: 'reproduced_once', notes: 'Settled result in automata theory.' },
  },
];

// --- sign and write ---------------------------------------------------------
const kp = core.generateKeypair();
console.log('Batch-2 identity: ' + kp.identity);
let failures = 0;
let written = 0;
for (const d of drafts) {
  const record = {
    nrs_version: '0.1',
    created: CREATED,
    ...d,
    provenance: { author: { type: 'mixed', identity: kp.identity, model: 'claude code (builder) + human executor' } },
  };
  record.id = core.computeId(record);
  record.provenance.signature = core.signRecord(record, kp.privateKeyPem);
  const errors = validate(schema, record);
  const check = core.verifyRecord(record);
  if (errors.length || !check.ok) {
    failures++;
    console.error('BATCH-2 INVALID: ' + d.problem.statement.slice(0, 60));
    console.error('  ' + [...errors, ...check.errors].join('\n  '));
    continue;
  }
  const dest = path.join(ROOT, 'records', core.shardPath(record.id));
  if (fs.existsSync(dest)) { failures++; console.error('unexpected id collision at ' + path.relative(ROOT, dest)); continue; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(record, null, 2) + '\n');
  written++;
  console.log('wrote ' + path.relative(ROOT, dest));
}
if (failures) { console.error(failures + ' failure(s)'); process.exit(1); }
console.log(written + ' record(s) written (corpus now ' + (SEED_COUNT + written) + '). Private key discarded with this process.');
process.exit(0);
