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
//!
//! Ledger-lock coverage (`docs/v5/delivery-plan.md` "帳本鎖"):
//!
//! - fills with a buy fee and a sell fee plus sell-side transaction tax,
//!   each posted as `FeeExpense`／`TaxExpense` inside one balanced batch
//!   ([`execution`]; rates are integer basis-point fixture parameters);
//! - trading halts: a halted instrument never fills, never accepts a new
//!   price, and an order whose lifetime overlaps a halt can only expire; the
//!   mark keeps the last accepted pre-halt price ([`execution`]);
//! - corporate actions: cash dividends (optional withholding tax), splits,
//!   reverse splits, and stock dividends applied lot by lot with exact
//!   cost-basis conservation and cash in lieu for fractional shares
//!   ([`corporate_action`]);
//! - corrections of a wrong dividend or share multiplier as additional
//!   balanced batches plus a new position event, never an edit of history;
//! - a deterministic property test (`tests/ledger_conservation.rs`) that
//!   checks batch balance, non-negative cash and quantity, cost-basis
//!   conservation across share multipliers, the equity identity, zero fills
//!   while halted, and at most one fill per order after every step.
//!
//! Deliberately not modelled: real tax-law detail (brackets, credits,
//! supplementary premiums), minimum fees, price-limit bands, partial fills,
//! rights issues, spin-offs, ex-date／pay-date separation, and rebasing a
//! pre-action price after a share multiplier (the mark fails closed until
//! the next accepted price instead).

pub mod account;
pub mod corporate_action;
pub mod execution;
pub mod order;
pub mod position;

pub type Id = [u8; 16];
pub type Digest = [u8; 32];
