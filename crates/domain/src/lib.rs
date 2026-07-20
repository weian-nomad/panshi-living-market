#![forbid(unsafe_code)]

pub mod decision_session;
pub mod round_desk;
/// Domain primitives shared by command handlers and deterministic tools.
///
/// Transport and persistence types intentionally do not live in this crate.
pub mod seat;
