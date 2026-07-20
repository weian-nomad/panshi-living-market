# ADR-0001: First production slice boundaries

- Status: Accepted
- Date: 2026-07-20
- Scope: Historical beta seating loop

## Decision

The first executable slice preserves the frozen `RoundDesk` and
`DecisionSession` aggregate boundary. `SaveSeatPlan` and `SealSeatPlan` write
the `RoundDesk` stream. `SealDecisionInput` writes the `DecisionSession` stream
only after verifying the committed `SeatPlanSealed` event ID, exact RoundDesk
version, and layout digest as precise preconditions.

The public contract has one source: handwritten OpenAPI 3.1 under
`contracts/openapi`. Rust edge DTOs, generated TypeScript client types,
Protobuf messages, and domain types remain different representations connected
by explicit converters and conformance fixtures. Generated Protobuf types may
not enter the domain or deterministic kernel crates.

Production runs three independent processes and database roles:

1. `game-core` validates and commits HTTP commands.
2. `decision-runner` consumes `DecisionInputSealed`, verifies the immutable
   snapshot, runs the pure kernel, and commits one `ActionsCommitted` batch.
3. `projection-worker` consumes canonical events and advances read models.

The three processes communicate through the PostgreSQL outbox/inbox contract.
They do not share an in-process queue or write each other's tables.

The first slice does not include an RPC framework. Internal messages use Buf
linted Protobuf and `prost`; same-deployment module boundaries use Rust ports.
An RPC transport is introduced only when a service boundary actually requires
network transport.

## Build order

1. Canonical Protobuf bytes, public OpenAPI, policy schema, and digests.
2. Contract conformance and sealed synthetic golden fixtures.
3. `RoundDesk` and `DecisionSession` state machines.
4. Pure fixed-point kernel with native and `wasm32-wasip1` parity.
5. Stream CAS, command deduplication, canonical events, outbox/inbox, snapshots.
6. Save, preview, seal, input freeze, and runner command handlers.
7. Reveal projection and generated web client.
8. Fault, replay, recovery, accessibility, and visual end-to-end gates.

SQL migrations start only after steps 1 through 4 have frozen the canonical
encoding and golden fixtures.

## Consequences

- HTTP, decision computation, and projection failures are isolated from the
  first production deployment.
- Scaling a consumer later does not require a new bounded-context split.
- Public contract changes fail CI unless generated clients and conformance
  fixtures are updated in the same change.
- The Historical v1 schema does not contain a second mode, real security
  identifiers, reverse lookup, external market links, or export capabilities.
