//! Character-lock assembly: turns the five character factors into the
//! kernel's frozen `AttentionComponents` and `ActionUtilityComponents`
//! (`docs/v5/character-story-engine.md` "注意" / "6. 合法行為";
//! `docs/v5/system-design.md` §8.4). This module owns the *mapping*; the
//! weights stay frozen in `panshi_decision_kernel::character_action` and are
//! never read or re-weighted here.
//!
//! Factor -> component mapping. It is exclusive: every component slot is
//! written by at most one factor, so removing one factor can only move the
//! slots listed on its own line.
//!
//! | Factor | Attention slot | Action-utility slot |
//! |---|---|---|
//! | personality (four axes + skills + habits) | `occupation_skill_and_existing_focus` | `habit_and_skill_fluency` |
//! | natal chart (`NatalMotif`) | `natal_symbolic_motif` | *(none)* |
//! | memory (triggerable salience) | `memory_trigger` | `activated_memory` |
//! | emotion (`DynamicState`) | *(none)* | `dynamic_emotion_and_agency` |
//! | relationship (pull / source trust) | `social_transmission_and_source_trust` | `relationship_impulse` |
//!
//! Slots no factor may write:
//!
//! - `core_appraisal`, `scene_accessibility`, `seeded_tie_noise`,
//!   `evidence_and_belief_fit`: only from the sealed fact / sealed appraisal
//!   carried on the candidate itself.
//! - `current_goal_and_need`, `current_goal_and_need_fit`: only from the
//!   sealed goal, likewise carried on the candidate.
//! - `cognitive_pattern_activation`: only from the pattern detector over
//!   sealed history (`bias.rs`), carried on the candidate.
//!
//! The natal chart has no action-utility slot at all -- a symbolic motif may
//! change what he looks at, never how much an action is worth. Blood type is
//! not a `CharacterFactors` field: it lives on `CharacterProfile` and reaches
//! only `CharacterProfile::social_tone_bp`, never a market component.
//!
//! Pure functions: fixed-point only, no clock, no randomness, no I/O, no
//! model call. The same inputs always give the same components, ranking and
//! choice.

use panshi_decision_kernel::{
    Fixed, FixedError,
    character_action::{
        ActionUtilityComponents, ActionUtilityWeights, AttentionComponents, AttentionWeights,
        action_utility_v1, attention_score,
    },
};

use crate::{
    Id,
    character::{DynamicState, FourAxisPreference},
    cognition::ActionKind,
};

/// Versioned identity of the mapping above. A change to which factor feeds
/// which slot, or to any per-factor formula below, is a new revision.
pub const ASSEMBLY_POLICY_REVISION: &str = "character-factor-assembly/v1";

/// Blood type's social-tone ceiling. It shapes self-description and social
/// tone only and is clamped to this magnitude.
pub const BLOOD_TYPE_SOCIAL_TONE_CAP_BP: i32 = 300;

const BP_MAX: i64 = 10_000;

/// What kind of sealed fact a candidate is. Personality reads it (which
/// facts his occupation and skills make easy to take in); nothing else does.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FactDomain {
    PriceTape,
    Filing,
    SocialRemark,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SkillProficiency {
    pub domain: FactDomain,
    pub proficiency_bp: i32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct HabitFluency {
    pub action: ActionKind,
    pub fluency_bp: i32,
}

/// Personality: the sealed four-axis preference plus the habits and skill
/// proficiencies that come with it.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Personality<'a> {
    pub four_axis: FourAxisPreference,
    pub skills: &'a [SkillProficiency],
    pub habits: &'a [HabitFluency],
}

/// One symbolic natal motif. It carries weight only on facts whose cue tags
/// meet its theme, and only until it expires.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NatalMotif<'a> {
    pub motif_id: &'a str,
    pub theme_tags: &'a [&'a str],
    pub strength_bp: i32,
    pub expires_at_unix_micros: i64,
}

/// A signed pull toward (or away from) one action kind.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ActionPull {
    pub action: ActionKind,
    pub pull_bp: i32,
}

/// A sealed memory that a fact's cue tag can bring back. `salience_bp` sets
/// how strongly it draws attention; `pull` is what it does to one action
/// once active, scaled by the same salience.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TriggerableMemory<'a> {
    pub memory_id: Id,
    pub cue_tag: &'a str,
    pub salience_bp: i32,
    pub pull: Option<ActionPull>,
}

/// One sealed relationship: how much he trusts what reaches him through the
/// counterpart, and the impulse the relationship puts on one action.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RelationshipPull<'a> {
    pub counterpart_ref: &'a str,
    pub source_trust_bp: i32,
    pub impulse: Option<ActionPull>,
}

/// The five character factors. Evidence and goals are deliberately absent:
/// they arrive on the candidate, from sealed facts and the sealed goal.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CharacterFactors<'a> {
    pub personality: Personality<'a>,
    pub natal_motif: Option<NatalMotif<'a>>,
    pub memories: &'a [TriggerableMemory<'a>],
    pub emotion: DynamicState,
    pub relationship: Option<RelationshipPull<'a>>,
}

/// Names one factor, for ablation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CharacterFactor {
    Personality,
    NatalChart,
    Memory,
    Emotion,
    Relationship,
}

impl CharacterFactors<'_> {
    /// The same factors with one of them set to its neutral value: zero
    /// axes and no skills or habits, no motif, no memories, neutral emotion,
    /// or no relationship.
    #[must_use]
    pub const fn without(self, factor: CharacterFactor) -> Self {
        let mut ablated = self;
        match factor {
            CharacterFactor::Personality => {
                ablated.personality = Personality {
                    four_axis: FourAxisPreference {
                        social_orientation_bp: 0,
                        information_orientation_bp: 0,
                        decision_orientation_bp: 0,
                        closure_orientation_bp: 0,
                    },
                    skills: &[],
                    habits: &[],
                };
            }
            CharacterFactor::NatalChart => ablated.natal_motif = None,
            CharacterFactor::Memory => ablated.memories = &[],
            CharacterFactor::Emotion => ablated.emotion = DynamicState::NEUTRAL,
            CharacterFactor::Relationship => ablated.relationship = None,
        }
        ablated
    }
}

/// One sealed fact offered to attention. Every `*_bp` field here comes from
/// the sealed fact, its sealed appraisal, or the sealed goal -- never from a
/// character factor.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AttentionCandidate<'a> {
    pub fact_revision_id: &'a str,
    pub domain: FactDomain,
    pub cue_tags: &'a [&'a str],
    /// The counterpart the fact reached him through, if any.
    pub source_ref: Option<&'a str>,
    pub evaluated_at_unix_micros: i64,
    pub core_appraisal_bp: i32,
    pub goal_relevance_bp: i32,
    pub scene_accessibility_bp: i32,
    pub seeded_tie_noise_bp: i32,
}

/// One legal action candidate, already past the hard action mask. Its
/// evidence fit comes from sealed facts, its goal fit from the sealed goal,
/// its pattern activation from the detector over sealed history.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ActionCandidate {
    pub action: ActionKind,
    pub evidence_fit_bp: i32,
    pub goal_fit_bp: i32,
    pub pattern_activation_bp: i32,
    pub cost_bp: i32,
}

impl ActionCandidate {
    #[must_use]
    pub fn cost(self) -> Fixed {
        bp_component(i64::from(self.cost_bp))
    }
}

/// Blood type as a social-tone input only.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BloodTypeTone<'a> {
    pub code: &'a str,
    pub social_tone_bp: i32,
}

/// Everything sealed about a character's disposition, including what must
/// never reach a market component.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CharacterProfile<'a> {
    pub factors: CharacterFactors<'a>,
    pub blood_type: BloodTypeTone<'a>,
}

impl CharacterProfile<'_> {
    #[must_use]
    pub fn attention(&self, candidate: &AttentionCandidate<'_>) -> AttentionComponents {
        assemble_attention(&self.factors, candidate)
    }

    #[must_use]
    pub fn action(&self, candidate: &ActionCandidate) -> ActionUtilityComponents {
        assemble_action(&self.factors, candidate)
    }

    /// The only place blood type is read, clamped to
    /// `BLOOD_TYPE_SOCIAL_TONE_CAP_BP`.
    #[must_use]
    pub fn social_tone_bp(&self) -> i32 {
        self.blood_type.social_tone_bp.clamp(
            -BLOOD_TYPE_SOCIAL_TONE_CAP_BP,
            BLOOD_TYPE_SOCIAL_TONE_CAP_BP,
        )
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AssemblyError {
    /// No candidate to rank or choose from. Fail closed: no default action
    /// is invented.
    NoCandidates,
    /// A fact candidate without a revision id cannot be attended to.
    MissingFactRevisionId,
    Kernel(FixedError),
}

impl From<FixedError> for AssemblyError {
    fn from(error: FixedError) -> Self {
        Self::Kernel(error)
    }
}

/// Attention components for one candidate fact.
#[must_use]
pub fn assemble_attention(
    factors: &CharacterFactors<'_>,
    candidate: &AttentionCandidate<'_>,
) -> AttentionComponents {
    AttentionComponents {
        // Sealed fact / appraisal / goal only.
        core_appraisal: bp_component(i64::from(candidate.core_appraisal_bp)),
        current_goal_and_need: bp_component(i64::from(candidate.goal_relevance_bp)),
        scene_accessibility: bp_component(i64::from(candidate.scene_accessibility_bp)),
        seeded_tie_noise: bp_component(i64::from(candidate.seeded_tie_noise_bp)),
        // One factor per slot.
        occupation_skill_and_existing_focus: bp_component(personality_focus_bp(
            &factors.personality,
            candidate.domain,
        )),
        memory_trigger: bp_component(memory_trigger_bp(factors.memories, candidate.cue_tags)),
        social_transmission_and_source_trust: bp_component(source_trust_bp(
            factors.relationship,
            candidate.source_ref,
        )),
        natal_symbolic_motif: bp_component(natal_motif_bp(factors.natal_motif, candidate)),
    }
}

/// Action-utility components for one candidate action. The natal motif is
/// not read here at all.
#[must_use]
pub fn assemble_action(
    factors: &CharacterFactors<'_>,
    candidate: &ActionCandidate,
) -> ActionUtilityComponents {
    ActionUtilityComponents {
        // Sealed facts / goal / pattern detector only.
        evidence_and_belief_fit: bp_component(i64::from(candidate.evidence_fit_bp)),
        current_goal_and_need_fit: bp_component(i64::from(candidate.goal_fit_bp)),
        cognitive_pattern_activation: bp_component(i64::from(candidate.pattern_activation_bp)),
        // One factor per slot.
        habit_and_skill_fluency: bp_component(habit_fluency_bp(
            &factors.personality,
            candidate.action,
        )),
        activated_memory: bp_component(activated_memory_bp(factors.memories, candidate.action)),
        dynamic_emotion_and_agency: bp_component(emotion_agency_bp(
            factors.emotion,
            candidate.action,
        )),
        relationship_impulse: bp_component(relationship_impulse_bp(
            factors.relationship,
            candidate.action,
        )),
    }
}

/// Candidate facts in attention order: score descending, then fact revision
/// id ascending as the deterministic tie-break.
///
/// # Errors
///
/// Fails closed on an empty candidate set, a candidate without a fact
/// revision id, or a kernel fixed-point overflow.
pub fn rank_attention<'c>(
    factors: &CharacterFactors<'_>,
    candidates: &[AttentionCandidate<'c>],
) -> Result<Vec<(&'c str, Fixed)>, AssemblyError> {
    if candidates.is_empty() {
        return Err(AssemblyError::NoCandidates);
    }
    let mut ranked = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        if candidate.fact_revision_id.is_empty() {
            return Err(AssemblyError::MissingFactRevisionId);
        }
        let score = attention_score(assemble_attention(factors, candidate), AttentionWeights::V1)?;
        ranked.push((candidate.fact_revision_id, score));
    }
    ranked.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(right.0)));
    Ok(ranked)
}

/// The highest-utility candidate. A tie goes to the less committal action
/// (no action, then wait, then read, then a paper order), never to an order.
///
/// # Errors
///
/// Fails closed on an empty candidate set or a kernel fixed-point overflow.
pub fn select_action(
    factors: &CharacterFactors<'_>,
    candidates: &[ActionCandidate],
) -> Result<(ActionKind, Fixed), AssemblyError> {
    let mut best: Option<(ActionKind, Fixed)> = None;
    for candidate in candidates {
        let utility = action_utility_v1(
            assemble_action(factors, candidate),
            ActionUtilityWeights::V1,
            candidate.cost(),
        )?;
        best = match best {
            Some((action, current))
                if current > utility
                    || (current == utility
                        && commitment_rank(action) <= commitment_rank(candidate.action)) =>
            {
                Some((action, current))
            }
            _ => Some((candidate.action, utility)),
        };
    }
    best.ok_or(AssemblyError::NoCandidates)
}

// -- per-factor formulas -------------------------------------------------------

/// Personality -> attention: skill proficiency in the fact's domain, plus
/// the axis that governs that domain (information orientation for filings,
/// social orientation for remarks passed on by people).
fn personality_focus_bp(personality: &Personality<'_>, domain: FactDomain) -> i64 {
    let skill = personality
        .skills
        .iter()
        .filter(|skill| skill.domain == domain)
        .map(|skill| i64::from(skill.proficiency_bp))
        .sum::<i64>();
    let axis = match domain {
        FactDomain::PriceTape => 0,
        FactDomain::Filing => i64::from(personality.four_axis.information_orientation_bp) / 2,
        FactDomain::SocialRemark => i64::from(personality.four_axis.social_orientation_bp) / 2,
    };
    skill + axis
}

/// Personality -> action: habit fluency for the action, plus the axis that
/// governs it (information orientation for reading, decision orientation
/// for committing to or holding off an order).
fn habit_fluency_bp(personality: &Personality<'_>, action: ActionKind) -> i64 {
    let habit = personality
        .habits
        .iter()
        .filter(|habit| habit.action == action)
        .map(|habit| i64::from(habit.fluency_bp))
        .sum::<i64>();
    let decision = i64::from(personality.four_axis.decision_orientation_bp);
    let axis = match action {
        ActionKind::NoAction => 0,
        ActionKind::ReadOrVerify => i64::from(personality.four_axis.information_orientation_bp) / 2,
        ActionKind::Wait => -decision / 4,
        ActionKind::PaperBuy | ActionKind::PaperSell => decision / 4,
    };
    habit + axis
}

/// Memory -> attention: the most salient memory the fact's cue tags bring
/// back.
fn memory_trigger_bp(memories: &[TriggerableMemory<'_>], cue_tags: &[&str]) -> i64 {
    memories
        .iter()
        .filter(|memory| cue_tags.contains(&memory.cue_tag))
        .map(|memory| i64::from(memory.salience_bp))
        .max()
        .unwrap_or(0)
}

/// Memory -> action: every memory's pull on this action, scaled by its
/// salience.
fn activated_memory_bp(memories: &[TriggerableMemory<'_>], action: ActionKind) -> i64 {
    memories
        .iter()
        .filter_map(|memory| {
            memory
                .pull
                .filter(|pull| pull.action == action)
                .map(|pull| i64::from(pull.pull_bp) * i64::from(memory.salience_bp) / BP_MAX)
        })
        .sum()
}

/// Emotion -> action. FOMO and confidence push toward buying and against
/// waiting; uncertainty pushes toward reading and waiting; stress and low
/// valence push toward reducing; fatigue drags on reading.
fn emotion_agency_bp(emotion: DynamicState, action: ActionKind) -> i64 {
    let fomo = i64::from(emotion.fomo_bp);
    let confidence = i64::from(emotion.confidence_bp);
    let uncertainty = i64::from(emotion.uncertainty_load_bp);
    let stress = i64::from(emotion.stress_bp);
    let valence = i64::from(emotion.valence_bp);
    let fatigue = i64::from(emotion.fatigue_bp);
    match action {
        ActionKind::NoAction => 0,
        ActionKind::PaperBuy => fomo + confidence / 2 - uncertainty / 2,
        ActionKind::PaperSell => stress / 2 - valence / 2 - confidence / 2,
        ActionKind::Wait => uncertainty / 2 + fatigue / 2 - fomo / 2,
        ActionKind::ReadOrVerify => uncertainty / 2 - fatigue / 2,
    }
}

/// Relationship -> attention: trust in what reached him through the
/// counterpart. A fact with no source, or another source, gets nothing.
fn source_trust_bp(relationship: Option<RelationshipPull<'_>>, source_ref: Option<&str>) -> i64 {
    match (relationship, source_ref) {
        (Some(relationship), Some(source)) if relationship.counterpart_ref == source => {
            i64::from(relationship.source_trust_bp)
        }
        _ => 0,
    }
}

/// Relationship -> action: the relationship's impulse on this action.
fn relationship_impulse_bp(relationship: Option<RelationshipPull<'_>>, action: ActionKind) -> i64 {
    relationship
        .and_then(|relationship| relationship.impulse)
        .filter(|impulse| impulse.action == action)
        .map_or(0, |impulse| i64::from(impulse.pull_bp))
}

/// Natal chart -> attention only: the motif's strength on a fact whose cue
/// tags meet its theme, while it has not expired.
fn natal_motif_bp(motif: Option<NatalMotif<'_>>, candidate: &AttentionCandidate<'_>) -> i64 {
    match motif {
        Some(motif)
            if candidate.evaluated_at_unix_micros <= motif.expires_at_unix_micros
                && motif
                    .theme_tags
                    .iter()
                    .any(|theme| candidate.cue_tags.contains(theme)) =>
        {
            i64::from(motif.strength_bp)
        }
        _ => 0,
    }
}

const fn commitment_rank(action: ActionKind) -> u8 {
    match action {
        ActionKind::NoAction => 0,
        ActionKind::Wait => 1,
        ActionKind::ReadOrVerify => 2,
        ActionKind::PaperSell => 3,
        ActionKind::PaperBuy => 4,
    }
}

/// Clamps a basis-point value to `[-10_000, 10_000]` and converts it to the
/// kernel's `[-1, 1]` fixed-point component.
fn bp_component(value_bp: i64) -> Fixed {
    Fixed::from_raw(value_bp.clamp(-BP_MAX, BP_MAX) * (Fixed::SCALE / BP_MAX))
}

#[cfg(test)]
mod tests {
    use super::{AttentionCandidate, FactDomain, NatalMotif, bp_component, natal_motif_bp};
    use panshi_decision_kernel::Fixed;

    const MOTIF: NatalMotif<'static> = NatalMotif {
        motif_id: "control_and_recognition",
        theme_tags: &["recognition"],
        strength_bp: 2_000,
        expires_at_unix_micros: 1_000,
    };

    fn candidate(evaluated_at_unix_micros: i64) -> AttentionCandidate<'static> {
        AttentionCandidate {
            fact_revision_id: "fact",
            domain: FactDomain::PriceTape,
            cue_tags: &["recognition"],
            source_ref: None,
            evaluated_at_unix_micros,
            core_appraisal_bp: 0,
            goal_relevance_bp: 0,
            scene_accessibility_bp: 0,
            seeded_tie_noise_bp: 0,
        }
    }

    #[test]
    fn an_expired_motif_carries_no_weight() {
        assert_eq!(natal_motif_bp(Some(MOTIF), &candidate(1_000)), 2_000);
        assert_eq!(natal_motif_bp(Some(MOTIF), &candidate(1_001)), 0);
    }

    #[test]
    fn components_are_clamped_to_the_unit_interval() {
        assert_eq!(bp_component(25_000), Fixed::ONE);
        assert_eq!(bp_component(-25_000), Fixed::NEG_ONE);
        assert_eq!(bp_component(5_000), Fixed::from_raw(500_000));
    }
}
