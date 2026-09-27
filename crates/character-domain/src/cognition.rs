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
    /// A candidate fact was available after
    /// `min(character world time, interaction cutoff, sealed_at)`.
    CutoffViolation,
    /// Sealing was attempted before any fact manifest was bound. Fail
    /// closed: an input with no manifest provenance is never sealed.
    ManifestUnbound,
    /// The seal request names a manifest other than the one currently
    /// bound, a manifest a pre-seal correction superseded, or carries a
    /// fact revision that correction superseded (an "old pack").
    SupersededManifest,
}

/// One candidate interaction fact offered to `CognitiveEpisode::seal_input`:
/// its revision id and the instant it became available to the world
/// (`FactBecameVisible.available_at_unix_micros`).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CandidateFact<'a> {
    pub fact_revision_id: &'a str,
    pub available_at_unix_micros: i64,
}

/// Everything the `CognitionInputSealed` command needs for the episode to
/// enforce the cutoff itself instead of trusting its caller.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SealInputRequest<'a> {
    /// The manifest the candidate facts were read from.
    pub manifest_id: &'a str,
    pub candidate_facts: &'a [CandidateFact<'a>],
    pub character_world_time_unix_micros: i64,
    pub sealed_at_unix_micros: i64,
    pub input_digest: Digest,
}

/// A correction of one fact revision by a later manifest, as Cognition sees
/// it (`docs/v5/system-design.md` §6.3). Before seal it rebinds the episode
/// to the correcting manifest; after seal it can only become a later
/// `FactCorrectionObserved` world event consumed by a subsequent episode.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FactCorrection<'a> {
    pub superseded_manifest_id: &'a str,
    pub superseded_fact_revision_id: &'a str,
    pub correction_manifest_id: &'a str,
    pub corrected_fact_revision_id: &'a str,
}

/// Where a correction goes, decided only by the episode's own state.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CorrectionRoute {
    /// Not yet sealed: rebuild the input against the correcting manifest.
    RebindBeforeSeal,
    /// Already sealed: the sealed digest and the decision knowledge stay as
    /// they were; the correction becomes a later world event.
    ObserveAfterSeal,
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
    /// The manifest the next seal must read from. Binding and pre-seal
    /// rebinding put no event on this stream; they are derived from the
    /// world stream's `FactManifestAccepted` events on replay.
    pub bound_manifest_id: Option<String>,
    /// Manifests and fact revisions a pre-seal correction replaced; a seal
    /// request citing any of them is rejected with `SupersededManifest`.
    pub superseded_manifest_ids: Vec<String>,
    pub superseded_fact_revision_ids: Vec<String>,
    /// The interaction allowlist actually sealed (empty until sealed).
    pub sealed_fact_revision_ids: Vec<String>,
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
            bound_manifest_id: None,
            superseded_manifest_ids: Vec::new(),
            superseded_fact_revision_ids: Vec::new(),
            sealed_fact_revision_ids: Vec::new(),
            input_digest: None,
            appraisal: None,
            attention: None,
            action_intent: None,
            speech_act: None,
        }
    }

    /// Binds the manifest the next seal must read from. Legal only while
    /// `Opened` and only once; a later manifest reaches an unsealed episode
    /// through `apply_pre_seal_correction`.
    ///
    /// # Errors
    ///
    /// `WrongState` once sealed or already bound; `SupersededManifest` for a
    /// manifest a pre-seal correction already replaced.
    pub fn bind_manifest(&mut self, manifest_id: &str) -> Result<(), CognitiveEpisodeError> {
        if self.state != CognitiveEpisodeState::Opened || self.bound_manifest_id.is_some() {
            return Err(CognitiveEpisodeError::WrongState);
        }
        if self.superseded_manifest_ids.iter().any(|id| id == manifest_id) {
            return Err(CognitiveEpisodeError::SupersededManifest);
        }
        self.bound_manifest_id = Some(manifest_id.to_owned());
        Ok(())
    }

    /// Where a correction arriving now must go. Decided only by state:
    /// anything past `Opened` has a sealed digest a correction may not touch.
    #[must_use]
    pub fn correction_route(&self) -> CorrectionRoute {
        if self.state == CognitiveEpisodeState::Opened {
            CorrectionRoute::RebindBeforeSeal
        } else {
            CorrectionRoute::ObserveAfterSeal
        }
    }

    /// A correction that arrives before `CognitionInputSealed`: the
    /// unsealed input is rebuilt against the correcting manifest, and the
    /// superseded manifest and fact revision can no longer be sealed.
    ///
    /// # Errors
    ///
    /// `WrongState` once sealed (that correction must become a
    /// `FactCorrectionObserved` world event instead); `ManifestUnbound` if
    /// no manifest was bound; `SupersededManifest` if the correction does
    /// not supersede the currently bound manifest.
    pub fn apply_pre_seal_correction(
        &mut self,
        correction: &FactCorrection<'_>,
    ) -> Result<(), CognitiveEpisodeError> {
        if self.correction_route() != CorrectionRoute::RebindBeforeSeal {
            return Err(CognitiveEpisodeError::WrongState);
        }
        match self.bound_manifest_id.as_deref() {
            None => return Err(CognitiveEpisodeError::ManifestUnbound),
            Some(bound) if bound != correction.superseded_manifest_id => {
                return Err(CognitiveEpisodeError::SupersededManifest);
            }
            Some(_) => {}
        }
        self.superseded_manifest_ids
            .push(correction.superseded_manifest_id.to_owned());
        self.superseded_fact_revision_ids
            .push(correction.superseded_fact_revision_id.to_owned());
        self.bound_manifest_id = Some(correction.correction_manifest_id.to_owned());
        Ok(())
    }

    /// Whether this (sealed) episode's knowledge included the fact revision a
    /// correction supersedes -- i.e. whether the correction must list it in
    /// `FactCorrectionObserved.affected_cognitive_episode_ids`.
    #[must_use]
    pub fn is_affected_by(&self, correction: &FactCorrection<'_>) -> bool {
        self.sealed_fact_revision_ids
            .iter()
            .any(|id| id == correction.superseded_fact_revision_id)
    }

    /// Whether this episode can be the one in which the character learns a
    /// post-seal correction (`CharacterCorrectionLearned`): its input is
    /// sealed, it carries the corrected revision, and it no longer carries
    /// the superseded one. Derived from sealed state only.
    #[must_use]
    pub fn learns_correction(&self, correction: &FactCorrection<'_>) -> bool {
        self.input_digest.is_some()
            && self
                .sealed_fact_revision_ids
                .iter()
                .any(|id| id == correction.corrected_fact_revision_id)
            && !self.is_affected_by(correction)
    }

    /// `CognitionInputSealed`. The episode itself enforces the three-way
    /// cutoff (`fact_is_interaction_eligible`) over every candidate fact and
    /// the manifest binding; a caller-side filter is at most a second line
    /// of defence, never the only one. A rejected seal leaves the episode in
    /// `Opened` at the same version.
    ///
    /// # Errors
    ///
    /// Rejects a stale version or wrong state; `ManifestUnbound` with no
    /// bound manifest; `SupersededManifest` for a manifest or fact revision
    /// that is not the currently bound one; `CutoffViolation` if any
    /// candidate fact was available after the cutoff.
    pub fn seal_input(
        &mut self,
        expected_version: u64,
        request: &SealInputRequest<'_>,
    ) -> Result<(), CognitiveEpisodeError> {
        self.check(expected_version, CognitiveEpisodeState::Opened)?;
        match self.bound_manifest_id.as_deref() {
            None => return Err(CognitiveEpisodeError::ManifestUnbound),
            Some(bound) if bound != request.manifest_id => {
                return Err(CognitiveEpisodeError::SupersededManifest);
            }
            Some(_) => {}
        }
        if request.candidate_facts.iter().any(|fact| {
            self.superseded_fact_revision_ids
                .iter()
                .any(|id| id == fact.fact_revision_id)
        }) {
            return Err(CognitiveEpisodeError::SupersededManifest);
        }
        if !request.candidate_facts.iter().all(|fact| {
            fact_is_interaction_eligible(
                fact.available_at_unix_micros,
                request.character_world_time_unix_micros,
                self.interaction_cutoff_unix_micros,
                request.sealed_at_unix_micros,
            )
        }) {
            return Err(CognitiveEpisodeError::CutoffViolation);
        }
        self.transition(
            expected_version,
            CognitiveEpisodeState::Opened,
            CognitiveEpisodeState::InputSealed,
        )?;
        self.sealed_fact_revision_ids = request
            .candidate_facts
            .iter()
            .map(|fact| fact.fact_revision_id.to_owned())
            .collect();
        self.input_digest = Some(request.input_digest);
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

    fn check(
        &self,
        expected_version: u64,
        required: CognitiveEpisodeState,
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
        Ok(())
    }

    fn transition(
        &mut self,
        expected_version: u64,
        required: CognitiveEpisodeState,
        next: CognitiveEpisodeState,
    ) -> Result<(), CognitiveEpisodeError> {
        self.check(expected_version, required)?;
        self.state = next;
        self.stream_version += 1;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ActionIntentRef, ActionKind, AppraisalRef, AppraisalSource, AttentionRef, CandidateFact,
        CognitiveEpisode, CognitiveEpisodeError, CognitiveEpisodeState, CorrectionRoute,
        FactCorrection, SealInputRequest, SpeechActOutcome, fact_is_interaction_eligible,
    };

    const MANIFEST: &str = "wfm-test-001";
    const CUTOFF: i64 = 1_000;
    const FACTS: &[CandidateFact<'static>] = &[CandidateFact {
        fact_revision_id: "fact-test-001",
        available_at_unix_micros: 500,
    }];

    fn opened() -> CognitiveEpisode {
        let mut episode = CognitiveEpisode::open([1; 16], [2; 16], CUTOFF);
        episode.bind_manifest(MANIFEST).expect("bind manifest");
        episode
    }

    const fn request<'a>(
        manifest_id: &'a str,
        candidate_facts: &'a [CandidateFact<'a>],
        input_digest: [u8; 32],
    ) -> SealInputRequest<'a> {
        SealInputRequest {
            manifest_id,
            candidate_facts,
            character_world_time_unix_micros: 900,
            sealed_at_unix_micros: 950,
            input_digest,
        }
    }

    #[test]
    fn cutoff_uses_the_earliest_of_three_bounds() {
        assert!(fact_is_interaction_eligible(100, 200, 150, 300));
        assert!(!fact_is_interaction_eligible(151, 200, 150, 300));
    }

    #[test]
    fn seal_input_rejects_fact_available_after_cutoff() {
        // Interaction cutoff 1_000 is later than both the character's world
        // time (900) and sealed_at (950): the binding bound is 900, so a
        // fact that became available at 901 is in the future for him.
        let late = [
            FACTS[0],
            CandidateFact {
                fact_revision_id: "fact-test-late",
                available_at_unix_micros: 901,
            },
        ];
        let mut episode = opened();
        assert_eq!(
            episode.seal_input(0, &request(MANIFEST, &late, [3; 32])),
            Err(CognitiveEpisodeError::CutoffViolation)
        );
        assert_eq!(episode.input_digest, None);
        assert!(episode.sealed_fact_revision_ids.is_empty());
    }

    #[test]
    fn seal_input_accepts_fact_at_exact_cutoff() {
        let at_bound = [CandidateFact {
            fact_revision_id: "fact-test-bound",
            available_at_unix_micros: 900,
        }];
        let mut episode = opened();
        episode
            .seal_input(0, &request(MANIFEST, &at_bound, [3; 32]))
            .expect("available_at == min(world time, cutoff, sealed_at) is eligible");
        assert_eq!(episode.state, CognitiveEpisodeState::InputSealed);
        assert_eq!(episode.sealed_fact_revision_ids, vec!["fact-test-bound".to_owned()]);
    }

    #[test]
    fn rejected_seal_leaves_episode_opened() {
        let late = [CandidateFact {
            fact_revision_id: "fact-test-late",
            available_at_unix_micros: 1_001,
        }];
        let mut episode = opened();
        let before = episode.clone();
        assert_eq!(
            episode.seal_input(0, &request(MANIFEST, &late, [3; 32])),
            Err(CognitiveEpisodeError::CutoffViolation)
        );
        assert_eq!(episode, before);
        assert_eq!(episode.state, CognitiveEpisodeState::Opened);
        assert_eq!(episode.stream_version, 0);
        // The same version can still be sealed with an eligible input.
        episode
            .seal_input(0, &request(MANIFEST, FACTS, [3; 32]))
            .expect("eligible retry at the unchanged version");
        assert_eq!(episode.stream_version, 1);
    }

    #[test]
    fn seal_without_a_bound_manifest_fails_closed() {
        let mut episode = CognitiveEpisode::open([1; 16], [2; 16], CUTOFF);
        assert_eq!(
            episode.seal_input(0, &request(MANIFEST, FACTS, [3; 32])),
            Err(CognitiveEpisodeError::ManifestUnbound)
        );
        assert_eq!(episode.state, CognitiveEpisodeState::Opened);
    }

    #[test]
    fn full_golden_path_with_speech_reaches_closed() {
        let mut episode = opened();
        episode
            .seal_input(0, &request(MANIFEST, FACTS, [3; 32]))
            .expect("seal input");
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
        let mut episode = opened();
        episode
            .seal_input(0, &request(MANIFEST, FACTS, [3; 32]))
            .expect("seal input");
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
        let mut episode = opened();
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
        let mut episode = opened();
        assert_eq!(
            episode.seal_input(9, &request(MANIFEST, FACTS, [3; 32])),
            Err(CognitiveEpisodeError::VersionConflict {
                expected: 9,
                actual: 0
            })
        );
    }

    const CORRECTION: FactCorrection<'static> = FactCorrection {
        superseded_manifest_id: MANIFEST,
        superseded_fact_revision_id: "fact-test-001",
        correction_manifest_id: "wfm-test-002",
        corrected_fact_revision_id: "fact-test-001-r2",
    };
    const CORRECTED_FACTS: &[CandidateFact<'static>] = &[CandidateFact {
        fact_revision_id: "fact-test-001-r2",
        available_at_unix_micros: 600,
    }];

    /// Golden failure set: fact correction before seal vs. after seal
    /// (`docs/v5/system-design.md` §6.3: "decision input seal 前到達的
    /// correction 必須進新 manifest；seal 後 correction 以
    /// `FactCorrectionObserved` 形成後續世界事件，不改寫角色當時知道的事").
    ///
    /// Before seal: the episode is rebound to the correcting manifest, and
    /// both the superseded manifest and the superseded revision (the "old
    /// pack") are refused at seal time.
    #[test]
    fn correction_before_seal_rebinds_and_refuses_the_old_pack() {
        let mut episode = opened();
        assert_eq!(episode.correction_route(), CorrectionRoute::RebindBeforeSeal);
        episode
            .apply_pre_seal_correction(&CORRECTION)
            .expect("pre-seal correction rebinds");
        assert_eq!(episode.bound_manifest_id.as_deref(), Some("wfm-test-002"));
        // Old manifest, old revision.
        assert_eq!(
            episode.seal_input(0, &request(MANIFEST, FACTS, [3; 32])),
            Err(CognitiveEpisodeError::SupersededManifest)
        );
        // New manifest id, but still the superseded revision.
        assert_eq!(
            episode.seal_input(0, &request("wfm-test-002", FACTS, [3; 32])),
            Err(CognitiveEpisodeError::SupersededManifest)
        );
        assert_eq!(episode.state, CognitiveEpisodeState::Opened);
        let corrected_digest = [99; 32];
        episode
            .seal_input(0, &request("wfm-test-002", CORRECTED_FACTS, corrected_digest))
            .expect("corrected pack seals");
        assert_eq!(episode.input_digest, Some(corrected_digest));
    }

    #[test]
    fn correction_after_seal_cannot_mutate_the_already_sealed_digest() {
        let mut episode = opened();
        let original_digest = [3; 32];
        episode
            .seal_input(0, &request(MANIFEST, FACTS, original_digest))
            .expect("seal input");

        // A late correction is routed away from this episode: it cannot be
        // applied, cannot reseal, and the sealed knowledge stays as it was.
        assert_eq!(episode.correction_route(), CorrectionRoute::ObserveAfterSeal);
        assert!(episode.is_affected_by(&CORRECTION));
        assert_eq!(
            episode.apply_pre_seal_correction(&CORRECTION),
            Err(CognitiveEpisodeError::WrongState)
        );
        assert_eq!(
            episode.seal_input(1, &request("wfm-test-002", CORRECTED_FACTS, [88; 32])),
            Err(CognitiveEpisodeError::WrongState)
        );
        assert_eq!(episode.input_digest, Some(original_digest));
        assert_eq!(episode.sealed_fact_revision_ids, vec!["fact-test-001".to_owned()]);
        // Counterexample: the affected episode itself never "learns" the
        // correction -- learning belongs to a later episode that sealed the
        // corrected revision.
        assert!(!episode.learns_correction(&CORRECTION));
    }

    #[test]
    fn only_a_later_episode_sealing_the_corrected_revision_learns_it() {
        let mut next = CognitiveEpisode::open([4; 16], [2; 16], 2_000);
        next.bind_manifest("wfm-test-002").expect("bind");
        assert!(!next.learns_correction(&CORRECTION), "unsealed episodes learn nothing");
        next.seal_input(0, &request("wfm-test-002", CORRECTED_FACTS, [5; 32]))
            .expect("seal corrected input");
        assert!(next.learns_correction(&CORRECTION));
        assert!(!next.is_affected_by(&CORRECTION));

        // Counterexample: a later episode that never saw the corrected
        // revision does not learn it.
        let unrelated = [CandidateFact {
            fact_revision_id: "fact-test-unrelated",
            available_at_unix_micros: 600,
        }];
        let mut other = CognitiveEpisode::open([6; 16], [2; 16], 2_000);
        other.bind_manifest("wfm-test-002").expect("bind");
        other
            .seal_input(0, &request("wfm-test-002", &unrelated, [7; 32]))
            .expect("seal unrelated input");
        assert!(!other.learns_correction(&CORRECTION));
    }
}
