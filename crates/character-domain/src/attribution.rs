//! Who a character publicly holds responsible for a loss
//! (`docs/v5/character-story-engine.md` 歸咎他人: "私下決定與對外歸因不一致";
//! `docs/v5/system-design.md` 歸因偏誤: "outcome 後把成功歸自己、失敗歸外部的
//! 結構化 attribution").
//!
//! This module answers one question -- *whom does he name?* -- from state and
//! history only: his current stress, his sealed core fear, whether the scene
//! is public, and whether a recent sealed memory ties him to someone (or
//! something) outside himself. It deliberately does NOT answer whether the
//! answer is fair. Fairness is `bias::BiasKind::BlameShift`'s job, and it is
//! decided afterwards against the canonical record of what he actually relied
//! on (`bias.rs`). Keeping the two apart is what lets a legitimate complaint
//! ("the source I relied on was corrected") and a shifted one ("the colleague
//! I ignored") come out of the same generator and still be told apart.
//!
//! Pure function, no randomness, no model call, no free text. The output is a
//! structured target; the spoken sentence is a separate sealed utterance from
//! the versioned fallback template table (`fallback.rs`).

/// Versioned policy identity for the rule below. Stored on every canonical
/// payload that carries a generated attribution.
pub const ATTRIBUTION_POLICY_REVISION: &str = "outcome-attribution-policy/v1";

/// The sealed core-fear code that makes public exposure bite
/// (`docs/v5/character-story-engine.md` 完整例子: 核心恐懼「公開顯得無知」).
pub const CORE_FEAR_PUBLIC_IGNORANCE_EXPOSURE: &str = "public_ignorance_exposure";

/// Stress at or above which an exposed character reaches for an external
/// target. Below it the same character, in the same room, owns the loss.
pub const EXTERNALIZING_STRESS_MIN_BP: i32 = 6_000;

/// How many sessions back (about two trading weeks) a sealed interaction
/// memory still counts as "recent" enough to hand him a name.
pub const RECENT_INTERACTION_WINDOW_SESSIONS: usize = 10;

/// The structured target of a public outcome statement.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AttributionTarget {
    /// He names himself.
    SelfOwn,
    /// He names another person, by the stable reference the world knows
    /// them by (a sealed character id or an acquaintance node id).
    ExternalCharacter(&'static str),
    /// He names an information source, by its fact revision id.
    ExternalSource(&'static str),
}

impl AttributionTarget {
    #[must_use]
    pub const fn is_external(self) -> bool {
        !matches!(self, Self::SelfOwn)
    }

    /// The named party's reference, or `None` when he names himself.
    #[must_use]
    pub const fn target_ref(self) -> Option<&'static str> {
        match self {
            Self::SelfOwn => None,
            Self::ExternalCharacter(reference) | Self::ExternalSource(reference) => Some(reference),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SpeechSetting {
    /// Others can hear him (a team meeting, a group thread).
    Public,
    /// Nobody else is present.
    Private,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CounterpartKind {
    Character,
    Source,
}

/// The most recent sealed memory that involves someone or something other
/// than himself. Only the reference and the session it was formed in matter
/// here; the memory itself stays in the memory ledger.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ExternalInteractionMemory {
    pub counterpart_kind: CounterpartKind,
    pub counterpart_ref: &'static str,
    pub formed_in_session_index: usize,
}

/// Everything the rule reads. Each field maps to sealed state: the dynamic
/// state he is in, the origin's core fear, the scene, and the memory ledger.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AttributionContext<'a> {
    pub session_index: usize,
    /// Whether a loss is known to him in this session. No loss, nothing to
    /// attribute.
    pub loss_recognized: bool,
    pub stress_bp: i32,
    pub core_fear_code: &'a str,
    pub setting: SpeechSetting,
    pub latest_external_interaction: Option<ExternalInteractionMemory>,
}

/// Decides whom he names for a recognized loss, or `None` when there is no
/// loss to speak about.
///
/// He reaches outward only when all of these hold at once: the scene is
/// public, his sealed core fear is exactly public exposure, his stress is at
/// or above `EXTERNALIZING_STRESS_MIN_BP`, and a sealed interaction memory
/// from the last `RECENT_INTERACTION_WINDOW_SESSIONS` sessions hands him a
/// name. Remove any one of them and he names himself. The rule never looks at
/// whether the named party actually misled him -- that is decided later, from
/// the record, by `bias::observe`.
#[must_use]
pub fn attribute_outcome(context: &AttributionContext<'_>) -> Option<AttributionTarget> {
    if !context.loss_recognized {
        return None;
    }
    let exposed = context.setting == SpeechSetting::Public
        && context.core_fear_code == CORE_FEAR_PUBLIC_IGNORANCE_EXPOSURE;
    let pressured = context.stress_bp >= EXTERNALIZING_STRESS_MIN_BP;
    let recent = context.latest_external_interaction.filter(|memory| {
        memory.formed_in_session_index <= context.session_index
            && context.session_index - memory.formed_in_session_index
                <= RECENT_INTERACTION_WINDOW_SESSIONS
    });
    match (exposed && pressured, recent) {
        (true, Some(memory)) => Some(match memory.counterpart_kind {
            CounterpartKind::Character => AttributionTarget::ExternalCharacter(memory.counterpart_ref),
            CounterpartKind::Source => AttributionTarget::ExternalSource(memory.counterpart_ref),
        }),
        _ => Some(AttributionTarget::SelfOwn),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AttributionContext, AttributionTarget, CORE_FEAR_PUBLIC_IGNORANCE_EXPOSURE,
        CounterpartKind, ExternalInteractionMemory, SpeechSetting, attribute_outcome,
    };

    const COLLEAGUE: &str = "acq-hist-001-xiaoyu";

    fn exposed_under_pressure() -> AttributionContext<'static> {
        AttributionContext {
            session_index: 20,
            loss_recognized: true,
            stress_bp: 6_200,
            core_fear_code: CORE_FEAR_PUBLIC_IGNORANCE_EXPOSURE,
            setting: SpeechSetting::Public,
            latest_external_interaction: Some(ExternalInteractionMemory {
                counterpart_kind: CounterpartKind::Character,
                counterpart_ref: COLLEAGUE,
                formed_in_session_index: 17,
            }),
        }
    }

    #[test]
    fn attribution_reaches_outward_only_when_state_and_history_line_up() {
        assert_eq!(
            attribute_outcome(&exposed_under_pressure()),
            Some(AttributionTarget::ExternalCharacter(COLLEAGUE))
        );
    }

    #[test]
    fn attribution_flips_to_self_when_stress_is_released() {
        let mut calmer = exposed_under_pressure();
        calmer.stress_bp = 4_700;
        assert_eq!(attribute_outcome(&calmer), Some(AttributionTarget::SelfOwn));
    }

    #[test]
    fn attribution_flips_to_self_without_a_recent_interaction_memory() {
        let mut no_memory = exposed_under_pressure();
        no_memory.latest_external_interaction = None;
        assert_eq!(attribute_outcome(&no_memory), Some(AttributionTarget::SelfOwn));

        // A memory older than the window no longer hands him a name.
        let mut stale = exposed_under_pressure();
        stale.session_index = 28;
        assert_eq!(attribute_outcome(&stale), Some(AttributionTarget::SelfOwn));
    }

    #[test]
    fn attribution_flips_to_self_in_private_or_with_a_different_core_fear() {
        let mut private = exposed_under_pressure();
        private.setting = SpeechSetting::Private;
        assert_eq!(attribute_outcome(&private), Some(AttributionTarget::SelfOwn));

        let mut other_fear = exposed_under_pressure();
        other_fear.core_fear_code = "loss_of_income";
        assert_eq!(attribute_outcome(&other_fear), Some(AttributionTarget::SelfOwn));
    }

    #[test]
    fn attribution_names_a_source_when_the_memory_is_about_a_source() {
        let mut source = exposed_under_pressure();
        source.latest_external_interaction = Some(ExternalInteractionMemory {
            counterpart_kind: CounterpartKind::Source,
            counterpart_ref: "fact-hist-001-s01-momentum",
            formed_in_session_index: 18,
        });
        assert_eq!(
            attribute_outcome(&source),
            Some(AttributionTarget::ExternalSource("fact-hist-001-s01-momentum"))
        );
    }

    #[test]
    fn attribution_is_absent_without_a_loss() {
        let mut no_loss = exposed_under_pressure();
        no_loss.loss_recognized = false;
        assert_eq!(attribute_outcome(&no_loss), None);
    }

    #[test]
    fn attribution_target_exposes_its_reference() {
        assert_eq!(AttributionTarget::SelfOwn.target_ref(), None);
        assert!(!AttributionTarget::SelfOwn.is_external());
        assert_eq!(
            AttributionTarget::ExternalCharacter(COLLEAGUE).target_ref(),
            Some(COLLEAGUE)
        );
        assert!(AttributionTarget::ExternalSource("fact-x").is_external());
    }
}
