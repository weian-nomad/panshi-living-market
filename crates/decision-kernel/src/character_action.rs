//! V5 per-character deterministic attention and action-utility math
//! (`docs/v5/character-story-engine.md` "注意" / "6. 合法行為"). This module
//! does not call `crate::decision`'s five-seat kernel at all; it is a
//! sibling built on the same `Fixed`/checked-arithmetic discipline. Only the
//! numeric core lives here (kept `no_std` for native/WASI parity, matching
//! this crate's existing discipline); fallback appraisal/utterance *text*
//! selection is a higher-level, non-numeric policy concern that lives in
//! `panshi-character-domain`, not here.

use crate::{Fixed, FixedError};

/// `docs/v5/system-design.md` §8.4 "V5 預設注意顯著度上限，總和為 10,000
/// basis points". A `const` assertion below checks the sum at compile time
/// so this table cannot silently drift from that invariant.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AttentionWeights {
    pub core_appraisal_bp: i32,
    pub current_goal_and_need_bp: i32,
    pub occupation_skill_and_existing_focus_bp: i32,
    pub memory_trigger_bp: i32,
    pub social_transmission_and_source_trust_bp: i32,
    pub natal_symbolic_motif_bp: i32,
    pub scene_accessibility_bp: i32,
    pub seeded_tie_noise_bp: i32,
}

impl AttentionWeights {
    pub const V1: Self = Self {
        core_appraisal_bp: 2_200,
        current_goal_and_need_bp: 1_800,
        occupation_skill_and_existing_focus_bp: 1_500,
        memory_trigger_bp: 1_200,
        social_transmission_and_source_trust_bp: 1_200,
        natal_symbolic_motif_bp: 800,
        scene_accessibility_bp: 800,
        seeded_tie_noise_bp: 500,
    };

    /// Sums every weight bucket; a new weight table revision should assert
    /// this equals `10_000` before being adopted as the active default.
    #[must_use]
    pub const fn sum_bp(self) -> i32 {
        self.core_appraisal_bp
            + self.current_goal_and_need_bp
            + self.occupation_skill_and_existing_focus_bp
            + self.memory_trigger_bp
            + self.social_transmission_and_source_trust_bp
            + self.natal_symbolic_motif_bp
            + self.scene_accessibility_bp
            + self.seeded_tie_noise_bp
    }
}

const _ATTENTION_WEIGHTS_V1_SUM_TO_TEN_THOUSAND_BP: () = {
    assert!(AttentionWeights::V1.sum_bp() == 10_000);
};

/// Per-candidate normalized component scores, each already clamped to
/// `[-Fixed::ONE, Fixed::ONE]` by the caller (this module does no clamping
/// of its own, matching `crate::decision`'s convention that callers own
/// input validation).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AttentionComponents {
    pub core_appraisal: Fixed,
    pub current_goal_and_need: Fixed,
    pub occupation_skill_and_existing_focus: Fixed,
    pub memory_trigger: Fixed,
    pub social_transmission_and_source_trust: Fixed,
    pub natal_symbolic_motif: Fixed,
    pub scene_accessibility: Fixed,
    pub seeded_tie_noise: Fixed,
}

fn weighted_bp(component: Fixed, weight_bp: i32) -> Result<Fixed, FixedError> {
    let weight = Fixed::from_raw(i64::from(weight_bp) * (Fixed::SCALE / 10_000));
    component.checked_mul(weight)
}

/// The deterministic attention score for one candidate fact, per
/// `docs/v5/system-design.md` §8.4's fixed weight table. Motif and noise
/// combined can never outweigh goals/skill/evidence, because the weights
/// themselves are fixed and each component is bounded to `[-1, 1]`.
///
/// # Errors
///
/// Returns [`FixedError::Overflow`] if a weighted term or the running sum
/// cannot fit in the canonical fixed-point representation.
pub fn attention_score(
    components: AttentionComponents,
    weights: AttentionWeights,
) -> Result<Fixed, FixedError> {
    let mut total = Fixed::ZERO;
    for (component, weight_bp) in [
        (components.core_appraisal, weights.core_appraisal_bp),
        (
            components.current_goal_and_need,
            weights.current_goal_and_need_bp,
        ),
        (
            components.occupation_skill_and_existing_focus,
            weights.occupation_skill_and_existing_focus_bp,
        ),
        (components.memory_trigger, weights.memory_trigger_bp),
        (
            components.social_transmission_and_source_trust,
            weights.social_transmission_and_source_trust_bp,
        ),
        (
            components.natal_symbolic_motif,
            weights.natal_symbolic_motif_bp,
        ),
        (
            components.scene_accessibility,
            weights.scene_accessibility_bp,
        ),
        (components.seeded_tie_noise, weights.seeded_tie_noise_bp),
    ] {
        total = total.checked_add(weighted_bp(component, weight_bp)?)?;
    }
    Ok(total)
}

/// `docs/v5/character-story-engine.md` "V5 初始 `BehaviorPolicy`": the
/// action-utility weight table. `evidence_and_belief_fit` is the only slot a
/// model appraisal may populate; `natal_symbolic_motif`/`blood_profile` have
/// no direct term at all (they may only reach utility indirectly through
/// need/emotion/memory/relationship, matching the product invariant that
/// natal charts never carry a direct security-direction weight).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ActionUtilityWeights {
    pub evidence_and_belief_fit_bp: i32,
    pub current_goal_and_need_fit_bp: i32,
    pub dynamic_emotion_and_agency_bp: i32,
    pub activated_memory_bp: i32,
    pub relationship_impulse_bp: i32,
    pub cognitive_pattern_activation_bp: i32,
    pub habit_and_skill_fluency_bp: i32,
}

impl ActionUtilityWeights {
    pub const V1: Self = Self {
        evidence_and_belief_fit_bp: 3_000,
        current_goal_and_need_fit_bp: 1_800,
        dynamic_emotion_and_agency_bp: 1_500,
        activated_memory_bp: 1_000,
        relationship_impulse_bp: 1_000,
        cognitive_pattern_activation_bp: 1_000,
        habit_and_skill_fluency_bp: 700,
    };
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ActionUtilityComponents {
    pub evidence_and_belief_fit: Fixed,
    pub current_goal_and_need_fit: Fixed,
    pub dynamic_emotion_and_agency: Fixed,
    pub activated_memory: Fixed,
    pub relationship_impulse: Fixed,
    pub cognitive_pattern_activation: Fixed,
    pub habit_and_skill_fluency: Fixed,
}

/// `U(action) = evidence×30% + goal×18% + emotion×15% + memory×10% +
/// relationship×10% + pattern×10% + habit×7% - cost`. `cost` is a hard mask
/// input (time/money/body/social), not itself weighted -- it is subtracted
/// directly, matching `docs/v5/character-story-engine.md`: "成本另有硬性
/// action mask，不能靠高情緒效用越過現金、持股、市場或身體限制" (the mask
/// itself -- rejecting a candidate outright when a hard constraint is
/// violated -- is the caller's responsibility; this function only computes
/// the soft utility score used to rank candidates that already passed the
/// mask).
///
/// # Errors
///
/// Returns [`FixedError::Overflow`] if any weighted term or the running
/// difference cannot fit in the canonical fixed-point representation.
pub fn action_utility_v1(
    components: ActionUtilityComponents,
    weights: ActionUtilityWeights,
    cost: Fixed,
) -> Result<Fixed, FixedError> {
    let mut total = Fixed::ZERO;
    for (component, weight_bp) in [
        (
            components.evidence_and_belief_fit,
            weights.evidence_and_belief_fit_bp,
        ),
        (
            components.current_goal_and_need_fit,
            weights.current_goal_and_need_fit_bp,
        ),
        (
            components.dynamic_emotion_and_agency,
            weights.dynamic_emotion_and_agency_bp,
        ),
        (components.activated_memory, weights.activated_memory_bp),
        (
            components.relationship_impulse,
            weights.relationship_impulse_bp,
        ),
        (
            components.cognitive_pattern_activation,
            weights.cognitive_pattern_activation_bp,
        ),
        (
            components.habit_and_skill_fluency,
            weights.habit_and_skill_fluency_bp,
        ),
    ] {
        total = total.checked_add(weighted_bp(component, weight_bp)?)?;
    }
    total.checked_sub(cost)
}

#[cfg(test)]
mod tests {
    use super::{
        ActionUtilityComponents, ActionUtilityWeights, AttentionComponents, AttentionWeights,
        action_utility_v1, attention_score,
    };
    use crate::Fixed;

    #[test]
    fn attention_weights_v1_sum_to_ten_thousand_bp() {
        let weights = AttentionWeights::V1;
        assert_eq!(
            weights.core_appraisal_bp
                + weights.current_goal_and_need_bp
                + weights.occupation_skill_and_existing_focus_bp
                + weights.memory_trigger_bp
                + weights.social_transmission_and_source_trust_bp
                + weights.natal_symbolic_motif_bp
                + weights.scene_accessibility_bp
                + weights.seeded_tie_noise_bp,
            10_000
        );
    }

    #[test]
    fn full_positive_components_saturate_to_one() {
        let full = AttentionComponents {
            core_appraisal: Fixed::ONE,
            current_goal_and_need: Fixed::ONE,
            occupation_skill_and_existing_focus: Fixed::ONE,
            memory_trigger: Fixed::ONE,
            social_transmission_and_source_trust: Fixed::ONE,
            natal_symbolic_motif: Fixed::ONE,
            scene_accessibility: Fixed::ONE,
            seeded_tie_noise: Fixed::ONE,
        };
        let score = attention_score(full, AttentionWeights::V1).expect("valid score");
        assert_eq!(score, Fixed::ONE);
    }

    #[test]
    fn motif_and_noise_cannot_outweigh_evidence_and_goals() {
        let motif_only = AttentionComponents {
            core_appraisal: Fixed::ZERO,
            current_goal_and_need: Fixed::ZERO,
            occupation_skill_and_existing_focus: Fixed::ZERO,
            memory_trigger: Fixed::ZERO,
            social_transmission_and_source_trust: Fixed::ZERO,
            natal_symbolic_motif: Fixed::ONE,
            scene_accessibility: Fixed::ZERO,
            seeded_tie_noise: Fixed::ONE,
        };
        let evidence_only = AttentionComponents {
            core_appraisal: Fixed::ONE,
            current_goal_and_need: Fixed::ZERO,
            occupation_skill_and_existing_focus: Fixed::ZERO,
            memory_trigger: Fixed::ZERO,
            social_transmission_and_source_trust: Fixed::ZERO,
            natal_symbolic_motif: Fixed::ZERO,
            scene_accessibility: Fixed::ZERO,
            seeded_tie_noise: Fixed::ZERO,
        };
        let motif_score = attention_score(motif_only, AttentionWeights::V1).expect("valid");
        let evidence_score = attention_score(evidence_only, AttentionWeights::V1).expect("valid");
        assert!(evidence_score > motif_score);
    }

    #[test]
    fn action_utility_matches_the_frozen_v1_weights() {
        let components = ActionUtilityComponents {
            evidence_and_belief_fit: Fixed::from_raw(600_000),
            current_goal_and_need_fit: Fixed::from_raw(400_000),
            dynamic_emotion_and_agency: Fixed::from_raw(800_000),
            activated_memory: Fixed::ZERO,
            relationship_impulse: Fixed::ZERO,
            cognitive_pattern_activation: Fixed::ZERO,
            habit_and_skill_fluency: Fixed::ZERO,
        };
        // 0.6*0.30 + 0.4*0.18 + 0.8*0.15 = 0.18 + 0.072 + 0.12 = 0.372
        let utility =
            action_utility_v1(components, ActionUtilityWeights::V1, Fixed::ZERO).expect("valid");
        assert_eq!(utility, Fixed::from_raw(372_000));
    }

    #[test]
    fn cost_is_subtracted_directly_not_weighted() {
        let neutral = ActionUtilityComponents {
            evidence_and_belief_fit: Fixed::ZERO,
            current_goal_and_need_fit: Fixed::ZERO,
            dynamic_emotion_and_agency: Fixed::ZERO,
            activated_memory: Fixed::ZERO,
            relationship_impulse: Fixed::ZERO,
            cognitive_pattern_activation: Fixed::ZERO,
            habit_and_skill_fluency: Fixed::ZERO,
        };
        let utility = action_utility_v1(
            neutral,
            ActionUtilityWeights::V1,
            Fixed::from_raw(50_000),
        )
        .expect("valid");
        assert_eq!(utility, Fixed::from_raw(-50_000));
    }
}
