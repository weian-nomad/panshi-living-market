#![forbid(unsafe_code)]

//! `legacy-v2`: the frozen five-seat `RoundDesk`/`SeatPlan`/`DecisionSession`
//! domain. See `LEGACY-V2-RESEARCH-V4.md` at the repository root and
//! `docs/v5/system-design.md` §18.3 ("Replace or archive"). New V5 modules
//! must not depend on this crate; `tools/contracts/check-boundaries.sh`
//! enforces that boundary in CI.

pub mod decision_session;
pub mod round_desk;
/// Domain primitives shared by command handlers and deterministic tools.
///
/// Transport and persistence types intentionally do not live in this crate.
pub mod seat;
