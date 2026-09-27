#![forbid(unsafe_code)]

//! V5 canonical Character Origin／Character Life／Cognition-Decision／Memory
//! domain, scoped to the one-character vertical slice
//! (`IMPLEMENTATION-HANDOFF.md` Phase 2, `docs/v5/system-design.md` §19
//! Phase 2). Pure domain: no transport, no ORM, no generated Protobuf types
//! (mirrors the discipline already documented on `panshi-protocol`: "Domain
//! and deterministic crates must never depend on this crate").
//!
//! `PaperAccount`／`PaperOrder`／`PaperPosition` deliberately live in the
//! sibling `panshi-paper-ledger` crate, not here: `docs/v5/system-design.md`
//! §4 fixes Paper Portfolio as its own bounded context, distinct from
//! Character Life, and this crate boundary is how that ownership separation
//! is enforced at the module level (`tools/contracts/check-boundaries.sh`
//! extends to this pair the same way it already does for the legacy-v2
//! crates).
//!
//! Scope note: `RelationshipDyad`/`EncounterMailbox` (Relationship bounded
//! context) are intentionally absent. The one-character slice has no second
//! character to form a relationship with; that is Phase 3
//! (`docs/v5/system-design.md` §19).

pub mod character;
pub mod cognition;
pub mod fallback;
pub mod gateway;
pub mod memory;
pub mod story;
pub mod utterance;

pub mod assembly;
pub mod attribution;
pub mod bias;
pub mod thesis;

pub type Id = [u8; 16];
pub type Digest = [u8; 32];
