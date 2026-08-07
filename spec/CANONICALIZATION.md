# NRS-0.1 Canonicalization, Hashing, and Signing

These rules make records content-addressed and tamper-evident. Implementations
MUST produce byte-identical canonical forms or interop breaks.

## Canonical body

The **canonical body** of a record is the record object with:

1. the top-level `id` field removed, and
2. `provenance.signature` removed,

serialized per **RFC 8785 (JSON Canonicalization Scheme)**: object keys sorted
by UTF-16 code units, no insignificant whitespace, JSON string escaping,
ECMAScript number serialization. NRS records use only strings, arrays, objects,
and (rarely) integers, so any faithful JCS subset covering those types is
conformant. Non-finite numbers are prohibited.

## Identifier

```
id = "nr:sha256:" + lowercase_hex( SHA-256( UTF-8( canonical_body ) ) )
```

Verification records use the prefix `nrv:` with the same construction.

## Filename

Records are stored at `registry/records/<hh>/<hash>.json`, where `<hash>` is
the 64-char hex digest and `<hh>` its first two characters. The filename MUST
equal the hash in `id` — CI enforces this. (The `nr:sha256:` prefix is omitted
from filenames because `:` is not portable across filesystems.)

## Signature

```
provenance.signature = base64url( Ed25519_sign( private_key, UTF-8( canonical_body ) ) )
```

`provenance.author.identity` is `"ed25519:" + base64url( SPKI_DER( public_key ) )`.
Verifiers reconstruct the public key from the identity string; no key registry
is required in v1.

## Order of operations for authors

1. Complete the draft (no `id`, no `signature`).
2. Compute `id` from the canonical body.
3. Sign the canonical body (which, by construction, is unchanged by step 2).
4. Emit the final record. Any later mutation invalidates both hash and signature.
