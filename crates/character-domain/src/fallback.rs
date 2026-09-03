//! Deterministic, versioned, no-network fallback policy
//! (`docs/v5/system-design.md` §17: "Cognition 模型 timeout/schema invalid...
//! 走不含 prose 的 appraisal fallback"; "Utterance realizer timeout/invalid/
//! unsafe -> verifier 只 reject；走同版本 deterministic fallback"). This is
//! not a degraded code path exercised only in failure tests: it is the ONLY
//! cognition/utterance path this Phase-2 slice exercises end to end, because
//! live model inference runs on approved external capacity, not on this
//! coordination machine (`IMPLEMENTATION-HANDOFF.md` "Before touching the
//! worktree" item 7). "Deterministic no-network fallback without retrying
//! for a preferred result" is itself one of the required Phase-2 slice
//! properties (`IMPLEMENTATION-HANDOFF.md` "The slice must...").
//!
//! Every function here is a pure `match`/table lookup over already-sealed,
//! structured state -- no randomness, no free text composition, no model
//! call. Fallback utterance templates are placeholder engineering fixture
//! copy, not reviewed product copy; a production release must run real
//! Traditional-Chinese template text through the repository's `copy-taste`
//! routing rule before this policy ships user-facing text.

use crate::cognition::ActionKind;
use crate::utterance::{GenerationMode, SealUtteranceRequest, SealingEventType, SurfaceKind};
use crate::{Digest, Id};

pub const FALLBACK_POLICY_REVISION: &str = "character-fallback-policy/v1";

/// A minimal, schema-honest stand-in for `CognitionAppraisalV1`
/// (`contracts/proto/panshi/character/v1/character.proto`). It carries
/// exactly one neutral fact appraisal per input fact and no interpretation
/// candidates, matching the product rule that a fallback must not invent
/// support/challenge claims it has no model output to justify.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FallbackAppraisal {
    pub fact_revision_ids: Vec<String>,
    pub relevance_bp: i32,
    pub reliability_bp: i32,
    pub uncertainty_bp: i32,
}

/// The versioned neutral appraisal: every admitted fact is treated as
/// moderately relevant, moderately reliable (it already passed the sealed-
/// fact/rights/cutoff gates upstream), and with deliberately elevated
/// uncertainty (a fallback should not claim the confidence a real appraisal
/// would have earned).
#[must_use]
pub fn deterministic_appraisal_fallback(fact_revision_ids: Vec<String>) -> FallbackAppraisal {
    FallbackAppraisal {
        fact_revision_ids,
        relevance_bp: 5_000,
        reliability_bp: 5_000,
        uncertainty_bp: 6_000,
    }
}

/// Which fixed action-kind bucket produced this template.
///
/// # Errors
///
/// None; this always returns a value. It is fallible-shaped only insofar as
/// callers must supply an already-legal `ActionKind` (no error variant
/// exists because every `ActionKind` has a defined template -- see the
/// `match` below).
#[must_use]
pub fn deterministic_speech_act_template(action: ActionKind) -> (&'static str, SurfaceKind) {
    match action {
        ActionKind::NoAction | ActionKind::Wait => (
            "目前沒有新的公開資訊，先維持原本的觀察。",
            SurfaceKind::SelfAcknowledged,
        ),
        ActionKind::ReadOrVerify => (
            "資料還沒看完，還不到下判斷的時候。",
            SurfaceKind::SelfAcknowledged,
        ),
        ActionKind::PaperBuy => (
            "看到新的公開資訊，先小部位觀察。",
            SurfaceKind::PublicSpeech,
        ),
        ActionKind::PaperSell => (
            "原本的理由已經不成立，先減碼。",
            SurfaceKind::PublicSpeech,
        ),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SealFallbackUtteranceRequest {
    pub utterance_artifact_id: Id,
    pub character_id: Id,
    pub semantic_speech_act_event_id: Id,
    pub action: ActionKind,
    pub sealed_at_unix_micros: i64,
}

/// Builds and seals the fallback `UtteranceArtifact` for a committed
/// semantic speech act, using the fixed template for the given action.
/// `sealing_event_type` is always `PublicClaimMade` for
/// `SurfaceKind::PublicSpeech`/`PublicWriting` and
/// `SelfAcknowledgementMade` for `SurfaceKind::SelfAcknowledged`, matching
/// `docs/v5/character-story-engine.md`'s fixed pairing.
#[must_use]
pub fn seal_fallback_utterance(
    request: SealFallbackUtteranceRequest,
) -> crate::utterance::UtteranceArtifact {
    let (template_text, surface_kind) = deterministic_speech_act_template(request.action);
    let sealing_event_type = match surface_kind {
        SurfaceKind::SelfAcknowledged => SealingEventType::SelfAcknowledgementMade,
        SurfaceKind::PublicSpeech | SurfaceKind::PublicWriting => SealingEventType::PublicClaimMade,
    };
    crate::utterance::UtteranceArtifact::seal(SealUtteranceRequest {
        utterance_artifact_id: request.utterance_artifact_id,
        character_id: request.character_id,
        semantic_speech_act_event_id: request.semantic_speech_act_event_id,
        sealing_event_type,
        surface_kind,
        canonical_text_utf8: template_text.to_owned(),
        generation_mode: GenerationMode::DeterministicFallback,
        sealed_at_unix_micros: request.sealed_at_unix_micros,
    })
}

/// A stable digest over the fallback policy revision and the input facts it
/// was applied to, suitable for embedding in `CoreAppraisalFallbackUsed`'s
/// canonical payload as `raw_output_digest`-equivalent provenance (the
/// fallback path has no raw model output, so this digest stands in as the
/// reproducibility anchor replay checks against).
#[must_use]
pub fn fallback_appraisal_digest(appraisal: &FallbackAppraisal) -> Digest {
    use sha2::{Digest as _, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(b"PSZS/FALLBACK_APPRAISAL/v1\0");
    hasher.update(FALLBACK_POLICY_REVISION.as_bytes());
    for fact_revision_id in &appraisal.fact_revision_ids {
        hasher.update(fact_revision_id.as_bytes());
        hasher.update([0]);
    }
    hasher.update(appraisal.relevance_bp.to_be_bytes());
    hasher.update(appraisal.reliability_bp.to_be_bytes());
    hasher.update(appraisal.uncertainty_bp.to_be_bytes());
    hasher.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::{
        SealFallbackUtteranceRequest, deterministic_appraisal_fallback,
        deterministic_speech_act_template, fallback_appraisal_digest, seal_fallback_utterance,
    };
    use crate::cognition::ActionKind;
    use crate::utterance::SurfaceKind;

    #[test]
    fn appraisal_fallback_is_neutral_and_never_invents_propositions() {
        let appraisal = deterministic_appraisal_fallback(vec!["fact-1".to_owned()]);
        assert_eq!(appraisal.relevance_bp, 5_000);
        assert_eq!(appraisal.fact_revision_ids, vec!["fact-1".to_owned()]);
    }

    #[test]
    fn same_input_produces_the_same_digest_every_time() {
        let appraisal = deterministic_appraisal_fallback(vec!["fact-1".to_owned()]);
        let first = fallback_appraisal_digest(&appraisal);
        let second = fallback_appraisal_digest(&appraisal);
        assert_eq!(first, second);
    }

    #[test]
    fn paper_buy_produces_a_public_claim_not_a_self_acknowledgement() {
        let (_, surface) = deterministic_speech_act_template(ActionKind::PaperBuy);
        assert_eq!(surface, SurfaceKind::PublicSpeech);
    }

    #[test]
    fn sealing_a_fallback_utterance_produces_deterministic_text_and_hash() {
        let artifact = seal_fallback_utterance(SealFallbackUtteranceRequest {
            utterance_artifact_id: [1; 16],
            character_id: [2; 16],
            semantic_speech_act_event_id: [3; 16],
            action: ActionKind::PaperBuy,
            sealed_at_unix_micros: 1_000,
        });
        assert_eq!(artifact.canonical_text_utf8, "看到新的公開資訊，先小部位觀察。");
        let replay = seal_fallback_utterance(SealFallbackUtteranceRequest {
            utterance_artifact_id: [9; 16],
            character_id: [2; 16],
            semantic_speech_act_event_id: [3; 16],
            action: ActionKind::PaperBuy,
            sealed_at_unix_micros: 1_000,
        });
        assert_eq!(artifact.canonical_text_sha256, replay.canonical_text_sha256);
    }
}
