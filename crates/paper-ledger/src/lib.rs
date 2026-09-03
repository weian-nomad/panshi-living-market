#![forbid(unsafe_code)]

//! V5 canonical Paper Portfolio domain
//! (`docs/v5/system-design.md` §4/§9.1): three non-overlapping aggregates,
//! `PaperAccount` (cash／reservation／double-entry journal／account
//! invariants), `PaperOrder` (requested terms／lifecycle／fill refs), and
//! `PaperPosition` (lots／quantity／cost basis／marks／position P&L／
//! corporate-action effects／outcome). No aggregate stores another's
//! authoritative field; a fill updates all three atomically from the
//! command-handler layer (see the episode runner in `tools/character-
//! episode`), not by one aggregate reaching into another's state.
//!
//! Pure domain: no transport, no ORM, no generated Protobuf types, and no
//! binary floating point anywhere (`docs/v5/system-design.md` §3) -- every
//! money/quantity/price value is `panshi_decision_kernel::Fixed`.

pub mod account;
pub mod order;
pub mod position;

pub type Id = [u8; 16];
pub type Digest = [u8; 32];
