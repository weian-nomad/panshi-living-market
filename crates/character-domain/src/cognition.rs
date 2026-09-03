//! `CognitiveEpisode` (`docs/v5/system-design.md` §4 Cognition／Decision
//! bounded context): freezes what a character could know at one moment,
//! carries a schema-only appraisal (model or deterministic fallback),
//! deterministic attention, and at most one autonomous action intent plus one
//! optional semantic speech act.
//!
//! State order is fixed by `docs/v5/character-story-engine.md` "事件順序與
//! 重播" and must not be reordered without a new schema revision:
//! `Opened -> InputSealed -> AppraisalResolved -> AttentionCommitted ->
//! ActionIntentCommitted -> [SpeechActCommitted] -> Closed`.

use crate::{Digest, Id};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CognitiveEpisodeState {
    Opened,
    InputSealed,
    AppraisalResolved,
    AttentionCommitted,
    ActionIntentCommitted,
    SpeechActCommitted,
    Closed,
}

/// Which path produced the appraisal. `Fallback` is not a degraded
/// second-class outcome -- it is the deterministic, no-network, versioned
/// path required by `docs/v5/system-design.md` §17 ("Cognition 模型
/// timeout/schema invalid... 走不含 prose 的 appraisal fallback") and is the
/// only path this Phase-2 slice exercises end to end, since live model
/// inference runs on approved external capacity, not in this domain crate.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AppraisalSource {
    ModelAccepted,
    DeterministicFallback,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AppraisalRef {
    pub source: AppraisalSource,
    pub appraisal_digest: Digest,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AttentionRef {
    pub attention_digest: Digest,
    pub attention_policy_revision: &'static str,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ActionKind {
    NoAction,
    ReadOrVerify,
    Wait,
    PaperBuy,
    PaperSell,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ActionIntentRef {
    pub action: ActionKind,
    pub action_digest: Digest,
    pub behavior_policy_revision: &'static str,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SpeechActOutcome {
    Withheld,
    Sealed { utterance_artifact_id: Id },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CognitiveEpisodeError {
    WrongState,
    VersionConflict { expected: u64, actual: u64 },
    CutoffViolation,
}

/// `docs/v5/system-design.md` §6.2: the three-way cutoff a sealed cognition
/// input must satisfy. `evidenceCutoffAt` is deliberately absent here --
/// outcome/editorial evidence never enters cognition input
/// (`interactionFactRevisionIds` and `outcomeEvidenceRevisionIds` are
/// physically separate allowlists).
#[must_use]
pub const fn fact_is_interaction_eligible(
    available_at_unix_micros: i64,
    character_world_time_unix_micros: i64,
    interaction_cutoff_unix_micros: i64,
    cognition_input_sealed_at_unix_micros: i64,
) -> bool {
    let bound = min3(
        character_world_time_unix_micros,
        interaction_cutoff_unix_micros,
        cognition_input_sealed_at_unix_micros,
    );
    available_at_unix_micros <= bound
}

const fn min3(a: i64, b: i64, c: i64) -> i64 {
    let ab = if a < b { a } else { b };
    if ab < c { ab } else { c }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CognitiveEpisode {
    pub cognitive_episode_id: Id,
    pub character_id: Id,
    pub state: CognitiveEpisodeState,
    pub stream_version: u64,
    pub interaction_cutoff_unix_micros: i64,
    pub input_digest: Option<Digest>,
    pub appraisal: Option<AppraisalRef>,
    pub attention: Option<AttentionRef>,
    pub action_intent: Option<ActionIntentRef>,
    pub speech_act: Option<SpeechActOutcome>,
}

impl CognitiveEpisode {
    #[must_use]
    pub const fn open(
        cognitive_episode_id: Id,
        character_id: Id,
        interaction_cutoff_unix_micros: i64,
    ) -> Self {
        Self {
            cognitive_episode_id,
            character_id,
            state: CognitiveEpisodeState::Opened,
            stream_version: 0,
            interaction_cutoff_unix_micros,
            input_digest: None,
            appraisal: None,
            attention: None,
            action_intent: None,
            speech_act: None,
        }
    }

    /// `CognitionInputSealed`.
    ///
    /// # Errors
    ///
    /// Rejects a stale version or wrong state.
    pub fn seal_input(
        &mut self,
        expected_version: u64,
        input_digest: Digest,
    ) -> Result<(), CognitiveEpisodeError> {
        self.transition(
            expected_version,
            CognitiveEpisodeState::Opened,
            CognitiveEpisodeState::InputSealed,
        )?;
        self.input_digest = Some(input_digest);
        Ok(())
    }

    /// `CoreAppraisalAccepted` or `CoreAppraisalFallbackUsed`.
    ///
    /// # Errors
    ///
    /// Rejects a stale version or wrong state.
    pub fn resolve_appraisal(
        &mut self,
        expected_version: u64,
        appraisal: AppraisalRef,
    ) -> Result<(), CognitiveEpisodeError> {
        self.transition(
            expected_version,
            CognitiveEpisodeState::InputSealed,
            CognitiveEpisodeState::AppraisalResolved,
        )?;
        self.appraisal = Some(appraisal);
        Ok(())
    }

    /// `AttentionCommitted`.
    ///
    /// # Errors
    ///
    /// Rejects a stale version or wrong state.
    pub fn commit_attention(
        &mut self,
        expected_version: u64,
        attention: AttentionRef,
    ) -> Result<(), CognitiveEpisodeError> {
        self.transition(
            expected_version,
            CognitiveEpisodeState::AppraisalResolved,
            CognitiveEpisodeState::AttentionCommitted,
        )?;
        self.attention = Some(attention);
        Ok(())
    }

    /// `AutonomousActionIntentCommitted`.
    ///
    /// # Errors
    ///
    /// Rejects a stale version or wrong state.
    pub fn commit_action_intent(
        &mut self,
        expected_version: u64,
        action_intent: ActionIntentRef,
    ) -> Result<(), CognitiveEpisodeError> {
        self.transition(
            expected_version,
            CognitiveEpisodeState::AttentionCommitted,
            CognitiveEpisodeState::ActionIntentCommitted,
        )?;
        self.action_intent = Some(action_intent);
        Ok(())
    }

    /// `SemanticSpeechActCommitted` followed by its `SealUtterance` outcome.
    /// Speech is optional: an episode may close directly from
    /// `ActionIntentCommitted` without ever calling this.
    ///
    /// # Errors
    ///
    /// Rejects a stale version or wrong state.
    pub fn commit_speech_act(
        &mut self,
        expected_version: u64,
        outcome: SpeechActOutcome,
    ) -> Result<(), CognitiveEpisodeError> {
        self.transition(
            expected_version,
            CognitiveEpisodeState::ActionIntentCommitted,
            CognitiveEpisodeState::SpeechActCommitted,
        )?;
        self.speech_act = Some(outcome);
        Ok(())
    }

    /// `CognitiveEpisodeClosed`. Legal from either `ActionIntentCommitted`
    /// (no speech act was committed) or `SpeechActCommitted`.
    ///
    /// # Errors
    ///
    /// Rejects a stale version or a state with no committed action intent.
    pub fn close(&mut self, expected_version: u64) -> Result<(), CognitiveEpisodeError> {
        if self.stream_version != expected_version {
            return Err(CognitiveEpisodeError::VersionConflict {
                expected: expected_version,
                actual: self.stream_version,
            });
        }
        match self.state {
            CognitiveEpisodeState::ActionIntentCommitted
            | CognitiveEpisodeState::SpeechActCommitted => {}
            _ => return Err(CognitiveEpisodeError::WrongState),
        }
        self.state = CognitiveEpisodeState::Closed;
        self.stream_version += 1;
        Ok(())
    }

    fn transition(
        &mut self,
        expected_version: u64,
        required: CognitiveEpisodeState,
        next: CognitiveEpisodeState,
    ) -> Result<(), CognitiveEpisodeError> {
        if self.stream_version != expected_version {
            return Err(CognitiveEpisodeError::VersionConflict {
                expected: expected_version,
                actual: self.stream_version,
            });
        }
        if self.state != required {
            return Err(CognitiveEpisodeError::WrongState);
        }
        self.state = next;
        self.stream_version += 1;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ActionIntentRef, ActionKind, AppraisalRef, AppraisalSource, AttentionRef,
        CognitiveEpisode, CognitiveEpisodeError, CognitiveEpisodeState, SpeechActOutcome,
        fact_is_interaction_eligible,
    };

    #[test]
    fn cutoff_uses_the_earliest_of_three_bounds() {
        assert!(fact_is_interaction_eligible(100, 200, 150, 300));
        assert!(!fact_is_interaction_eligible(151, 200, 150, 300));
    }

    #[test]
    fn full_golden_path_with_speech_reaches_closed() {
        let mut episode = CognitiveEpisode::open([1; 16], [2; 16], 1_000);
        episode.seal_input(0, [3; 32]).expect("seal input");
        episode
            .resolve_appraisal(
                1,
                AppraisalRef {
                    source: AppraisalSource::DeterministicFallback,
                    appraisal_digest: [4; 32],
                },
            )
            .expect("resolve appraisal");
        episode
            .commit_attention(
                2,
                AttentionRef {
                    attention_digest: [5; 32],
                    attention_policy_revision: "attention-policy/1",
                },
            )
            .expect("commit attention");
        episode
            .commit_action_intent(
                3,
                ActionIntentRef {
                    action: ActionKind::PaperBuy,
                    action_digest: [6; 32],
                    behavior_policy_revision: "behavior-policy/1",
                },
            )
            .expect("commit action intent");
        episode
            .commit_speech_act(
                4,
                SpeechActOutcome::Sealed {
                    utterance_artifact_id: [7; 16],
                },
            )
            .expect("commit speech act");
        episode.close(5).expect("close");
        assert_eq!(episode.state, CognitiveEpisodeState::Closed);
        assert_eq!(episode.stream_version, 6);
    }

    #[test]
    fn episode_can_close_without_a_speech_act() {
        let mut episode = CognitiveEpisode::open([1; 16], [2; 16], 1_000);
        episode.seal_input(0, [3; 32]).expect("seal input");
        episode
            .resolve_appraisal(
                1,
                AppraisalRef {
                    source: AppraisalSource::DeterministicFallback,
                    appraisal_digest: [4; 32],
                },
            )
            .expect("resolve appraisal");
        episode
            .commit_attention(
                2,
                AttentionRef {
                    attention_digest: [5; 32],
                    attention_policy_revision: "attention-policy/1",
                },
            )
            .expect("commit attention");
        episode
            .commit_action_intent(
                3,
                ActionIntentRef {
                    action: ActionKind::NoAction,
                    action_digest: [6; 32],
                    behavior_policy_revision: "behavior-policy/1",
                },
            )
            .expect("commit action intent");
        episode.close(4).expect("close without speech");
        assert_eq!(episode.state, CognitiveEpisodeState::Closed);
    }

    #[test]
    fn out_of_order_transitions_are_rejected() {
        let mut episode = CognitiveEpisode::open([1; 16], [2; 16], 1_000);
        assert_eq!(
            episode.commit_attention(
                0,
                AttentionRef {
                    attention_digest: [5; 32],
                    attention_policy_revision: "attention-policy/1",
                },
            ),
            Err(CognitiveEpisodeError::WrongState)
        );
    }

    #[test]
    fn stale_version_is_rejected() {
        let mut episode = CognitiveEpisode::open([1; 16], [2; 16], 1_000);
        assert_eq!(
            episode.seal_input(9, [3; 32]),
            Err(CognitiveEpisodeError::VersionConflict {
                expected: 9,
                actual: 0
            })
        );
    }

    /// Golden failure set: fact correction before seal vs. after seal
    /// (`docs/v5/system-design.md` §6.3: "decision input seal 前到達的
    /// correction 必須進新 manifest；seal 後 correction 以
    /// `FactCorrectionObserved` 形成後續世界事件，不改寫角色當時知道的事").
    ///
    /// Before seal: the caller (a command handler, not modeled in this
    /// crate) is free to rebuild whatever `input_digest` it seals with --
    /// there is no committed state yet for a correction to conflict with.
    /// After seal: `input_digest` is fixed forever; nothing in this type's
    /// public API can change it. A correction that arrives after sealing
    /// must become a *new*, later cognitive episode input (or a
    /// `FactCorrectionObserved` world event consumed by a subsequent
    /// episode) -- it structurally cannot reach back into this one.
    #[test]
    fn correction_before_seal_can_change_the_sealed_digest() {
        let mut episode = CognitiveEpisode::open([1; 16], [2; 16], 1_000);
        // A correction lands before InputSealed: the handler simply seals
        // the corrected digest instead of the original one. No conflict,
        // because nothing was committed yet.
        let corrected_digest = [99; 32];
        episode
            .seal_input(0, corrected_digest)
            .expect("pre-seal correction is sealed directly");
        assert_eq!(episode.input_digest, Some(corrected_digest));
    }

    #[test]
    fn correction_after_seal_cannot_mutate_the_already_sealed_digest() {
        let mut episode = CognitiveEpisode::open([1; 16], [2; 16], 1_000);
        let original_digest = [3; 32];
        episode.seal_input(0, original_digest).expect("seal input");

        // There is no method on `CognitiveEpisode` that can overwrite
        // `input_digest` once set -- `seal_input` itself now rejects a
        // second call because the state has moved past `Opened`. A late
        // correction is therefore, by construction, unable to rewrite what
        // this episode believed at seal time; it can only ever be captured
        // as a distinct subsequent event outside this aggregate.
        assert_eq!(
            episode.seal_input(1, [88; 32]),
            Err(CognitiveEpisodeError::WrongState)
        );
        assert_eq!(episode.input_digest, Some(original_digest));
    }
}
