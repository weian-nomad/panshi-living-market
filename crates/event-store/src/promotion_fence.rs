//! Region-loss promotion fence, at the contract／test-double level
//! (`docs/v5/system-design.md` §14/§17: "Failover target 在升為 writer
//! 前，必須證明 WAL／global-position／hash-chain 無缺口，command journal 可
//! 重建 idempotency，且 outbox pointer 與 canonical transaction 一一完整；任何
//! 一項無法證明就維持 stale read-only").
//!
//! This module does NOT exercise real multi-region `PostgreSQL` replication,
//! AZ/region kill switches, or an actual failover drill -- `docs/v5/system-
//! design.md` and `IMPLEMENTATION-HANDOFF.md` are explicit that the
//! infrastructure RPO/RTO gate may only be claimed after a real
//! fault-injection drill, which is out of scope for a coordination-Mac
//! implementation pass. What this module proves, honestly and at the scope
//! it claims: the DECISION LOGIC that gates promotion is a pure function of
//! an explicit, typed continuity proof, and it fails closed (stays
//! stale-read-only) unless every required condition is independently true.
//! A real region-loss drill still owes independent evidence that a
//! candidate writer can actually *produce* a true `ContinuityProof`; this
//! module only proves the gate cannot be talked into promoting on a false
//! or partial one.

/// The four independently-required conditions
/// (`docs/v5/system-design.md` §14) a failover target must prove before it
/// may accept canonical writes. Every field defaults to `false`; there is no
/// "trust me" shortcut -- a caller must explicitly construct proof for each.
// Five independent, orthogonal proof obligations, not mutually exclusive
// states -- a state machine or enum encoding would obscure that all five
// must hold simultaneously, which is the exact invariant this type exists
// to make explicit.
#[allow(clippy::struct_excessive_bools)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ContinuityProof {
    pub wal_gap_free: bool,
    pub global_position_contiguous: bool,
    pub hash_chain_intact: bool,
    pub command_idempotency_rebuildable: bool,
    pub outbox_pointer_complete: bool,
}

impl ContinuityProof {
    /// A proof where every required condition holds. Only useful as a test
    /// fixture starting point -- no code path in this crate constructs this
    /// automatically from a real replica's state.
    pub const ALL_PROVEN: Self = Self {
        wal_gap_free: true,
        global_position_contiguous: true,
        hash_chain_intact: true,
        command_idempotency_rebuildable: true,
        outbox_pointer_complete: true,
    };
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WriterPromotionDecision {
    /// All five conditions proven: this replica may accept canonical writes.
    PromoteToWriter,
    /// At least one condition unproven: fail closed. Public reads may
    /// continue from existing projections (`docs/v5/system-design.md` §14:
    /// "canonical mutation fail closed；公共讀取可以用帶有 source position／
    /// stale 標記的既有投影繼續"), but no canonical write is accepted.
    StaleReadOnly,
}

/// The promotion gate itself: a pure function, fails closed on any single
/// unproven condition. There is deliberately no partial-credit path (e.g.
/// "4 of 5 proven is good enough") -- `docs/v5/system-design.md` requires
/// ALL of WAL/global-position/hash-chain/idempotency/outbox-completeness
/// before a target may become writer.
#[must_use]
pub const fn evaluate_promotion(proof: ContinuityProof) -> WriterPromotionDecision {
    if proof.wal_gap_free
        && proof.global_position_contiguous
        && proof.hash_chain_intact
        && proof.command_idempotency_rebuildable
        && proof.outbox_pointer_complete
    {
        WriterPromotionDecision::PromoteToWriter
    } else {
        WriterPromotionDecision::StaleReadOnly
    }
}

#[cfg(test)]
mod tests {
    use super::{ContinuityProof, WriterPromotionDecision, evaluate_promotion};

    #[test]
    fn every_condition_proven_allows_promotion() {
        assert_eq!(
            evaluate_promotion(ContinuityProof::ALL_PROVEN),
            WriterPromotionDecision::PromoteToWriter
        );
    }

    #[test]
    fn any_single_unproven_condition_fails_closed() {
        let all_but_wal = ContinuityProof {
            wal_gap_free: false,
            ..ContinuityProof::ALL_PROVEN
        };
        assert_eq!(evaluate_promotion(all_but_wal), WriterPromotionDecision::StaleReadOnly);

        let all_but_global_position = ContinuityProof {
            global_position_contiguous: false,
            ..ContinuityProof::ALL_PROVEN
        };
        assert_eq!(
            evaluate_promotion(all_but_global_position),
            WriterPromotionDecision::StaleReadOnly
        );

        let all_but_hash_chain = ContinuityProof {
            hash_chain_intact: false,
            ..ContinuityProof::ALL_PROVEN
        };
        assert_eq!(
            evaluate_promotion(all_but_hash_chain),
            WriterPromotionDecision::StaleReadOnly
        );

        let all_but_idempotency = ContinuityProof {
            command_idempotency_rebuildable: false,
            ..ContinuityProof::ALL_PROVEN
        };
        assert_eq!(
            evaluate_promotion(all_but_idempotency),
            WriterPromotionDecision::StaleReadOnly
        );

        let all_but_outbox = ContinuityProof {
            outbox_pointer_complete: false,
            ..ContinuityProof::ALL_PROVEN
        };
        assert_eq!(evaluate_promotion(all_but_outbox), WriterPromotionDecision::StaleReadOnly);
    }

    #[test]
    fn no_conditions_proven_fails_closed() {
        assert_eq!(
            evaluate_promotion(ContinuityProof::default()),
            WriterPromotionDecision::StaleReadOnly
        );
    }
}
