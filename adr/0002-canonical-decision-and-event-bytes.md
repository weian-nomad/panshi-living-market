# ADR-0002: Canonical decision bytes and atomic event append

- Status: Accepted
- Date: 2026-07-20
- Scope: Historical v1 decision and canonical persistence

## Decision

The bytes, not an in-memory object or JSON rendering, are the replay contract.
`DecisionKernelInputV1` and `DecisionKernelOutputV1` are versioned Protobuf
messages with no maps, no floating-point fields, and domain-owned repeated-field
order. A persisted message is valid only when decoding and re-encoding with the
pinned schema produces the exact original byte sequence. All digests use a
versioned, NUL-terminated domain tag.

The sealed input binds the decision session, round, content session, logical
cell, ownership epoch, `DecisionInputSealed` event ID, session input version,
snapshot digest, kernel ABI digest, algorithm bundle digest, and all five seats. `ActionsCommitted` must
repeat the sealed event ID, session input version, input digest, snapshot digest,
kernel ABI digest, and algorithm digest. The algorithm bundle digest length-frames
the algorithm ID, kernel ABI, and exact policy artifact bytes. A runner result from an older seal is invalid even when
its business payload looks equivalent.

The policy ranks candidates by the exact checked `i128` numerator:

```text
N = 2 × q_raw × conviction_raw × 1_000_000
    − q_raw × q_raw × resistance_raw
```

Only the published utility fields divide `N` by `10^12`, truncating toward
zero. Ranking never uses the rounded value. Equal exact numerators use the
tagged SHA-256 tie rank defined in `contracts/policy/decision-v1.json`.

Canonical events are appended only through `event_store.append_batch(jsonb)`.
The SECURITY DEFINER function runs as a dedicated NOLOGIN owner role and, in one
transaction, performs command deduplication, locks stream heads in canonical
order, checks stream version and ownership epoch, inserts hash-chained events,
inserts exactly one outbox pointer per event, advances heads, and freezes the
receipt. Application writer roles have no direct table or sequence writes.

Every event hash covers length-framed immutable metadata, the previous hash,
and the generated payload SHA-256 under `PSZS/EVENT/v1\0`. The database checks
the hash expression, first-event versus later-event previous-hash shape,
event-to-outbox completeness, outbox-to-event identity, and receipt-to-command
event IDs. An idempotent replay returns the frozen receipt; a changed request
hash or stale precondition fails closed.

## Qualification

- `fixtures/historical/episode-001/input.pb` and `output.pb` are checked-in
  canonical bytes with pinned SHA-256 values.
- The simulator regenerates the fixture from typed inputs and runs the kernel.
- `tools/verify-kernel-parity.sh` compares native output, WASI output, and the
  sealed golden file byte for byte.
- The PostgreSQL integration test applies the real migration and verifies first
  append, idempotent replay, digest conflict, version conflict, hash-chain head,
  outbox cardinality, and denial of a direct writer-role table insert.

## Consequences

- A schema or policy change requires a new version, new domain tag where the
  preimage changes, and new golden fixtures; it cannot silently reinterpret old
  history.
- JSON remains an inspection aid, not the deterministic execution contract.
- PostgreSQL is the first production write boundary. Replacing it requires an
  adapter that reproduces the same receipt, CAS, deduplication, and hash-chain
  semantics before migration is allowed.
