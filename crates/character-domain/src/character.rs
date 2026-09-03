//! `Character` (immutable origin, docs/v5/character-story-engine.md "出生與
//! 身份") and `CharacterLife` (dynamic state, commitment rationale, sealed
//! public claims -- docs/v5/system-design.md §4's Character Life bounded
//! context).

use panshi_decision_kernel::Fixed;

use crate::{Digest, Id};

/// `docs/v5/character-story-engine.md` "四軸性格偏好". Values are
/// basis-point-scaled (`-10_000..=10_000`); this crate does not clamp them
/// itself (fixed-point range validation belongs to the sealing command
/// handler, which already has bounds-checked `Fixed` inputs from generation
/// policy), it only carries them.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FourAxisPreference {
    pub social_orientation_bp: i32,
    pub information_orientation_bp: i32,
    pub decision_orientation_bp: i32,
    pub closure_orientation_bp: i32,
}

/// Immutable identity sealed once by `CharacterOriginSealed`
/// (`docs/v5/system-design.md` §8.1). Never rewritten; a character is never
/// re-rolled after birth (`docs/v5/product-constitution.md` "角色自主").
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Character {
    pub character_id: Id,
    pub origin_seed_commitment: [u8; 32],
    pub generation_policy_revision: &'static str,
    pub four_axis: FourAxisPreference,
    pub model_core_id: &'static str,
    pub origin_digest: Digest,
}

impl Character {
    #[must_use]
    pub const fn new(
        character_id: Id,
        origin_seed_commitment: [u8; 32],
        generation_policy_revision: &'static str,
        four_axis: FourAxisPreference,
        model_core_id: &'static str,
        origin_digest: Digest,
    ) -> Self {
        Self {
            character_id,
            origin_seed_commitment,
            generation_policy_revision,
            four_axis,
            model_core_id,
            origin_digest,
        }
    }
}

/// `docs/v5/character-story-engine.md` "動態狀態與生活壓力". A small,
/// slice-scoped subset (valence/arousal/stress/fatigue/confidence/fomo/
/// uncertainty) -- the full set (regret/shame/envy/loneliness/social
/// exposure/agency/sleep debt) is declared in the wire contract
/// (`contracts/proto/panshi/character/v1/character.proto`'s
/// `DynamicStateV1`) but not yet load-bearing in this Phase-2 slice's
/// behavior policy.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DynamicState {
    pub valence_bp: i32,
    pub arousal_bp: i32,
    pub stress_bp: i32,
    pub fatigue_bp: i32,
    pub confidence_bp: i32,
    pub fomo_bp: i32,
    pub uncertainty_load_bp: i32,
}

impl DynamicState {
    pub const NEUTRAL: Self = Self {
        valence_bp: 0,
        arousal_bp: 0,
        stress_bp: 0,
        fatigue_bp: 0,
        confidence_bp: 0,
        fomo_bp: 0,
        uncertainty_load_bp: 0,
    };
}

/// A structured, quote-free investment thesis
/// (`docs/v5/character-story-engine.md` "信念與自我敘述" ->
/// `CommitmentRationaleSealed`: "永遠只存 structured rationale，不含 quote 或
/// artifact"). If the character later speaks the reason aloud, that is a
/// *separate* `SemanticSpeechActCommitted` -> `UtteranceArtifact`, never a
/// rewrite of this rationale.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CommitmentRationale {
    pub thesis_id: Id,
    pub security_id_hash: Digest,
    pub opened_at_unix_micros: i64,
    pub intended_horizon_unix_micros: i64,
    pub confidence: Fixed,
    pub invalidation_condition_code: &'static str,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CharacterLifeError {
    WrongVersion { expected: u64, actual: u64 },
    ThesisAlreadyOpen,
    NoOpenThesis,
}

/// `docs/v5/system-design.md` §4: "needs、emotion、belief、commitment、sealed
/// public claims 與 behavioral progression". This slice keeps one open
/// thesis at a time (sufficient for a single autonomous paper action); a
/// full multi-thesis ledger is out of scope for Phase 2.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CharacterLife {
    pub character_id: Id,
    pub stream_version: u64,
    pub dynamic_state: DynamicState,
    pub open_thesis: Option<CommitmentRationale>,
}

impl CharacterLife {
    #[must_use]
    pub const fn new(character_id: Id) -> Self {
        Self {
            character_id,
            stream_version: 0,
            dynamic_state: DynamicState::NEUTRAL,
            open_thesis: None,
        }
    }

    /// `CharacterStateAdvanced`: advances dynamic state deterministically.
    ///
    /// # Errors
    ///
    /// Rejects a stale expected version.
    pub fn advance_state(
        &mut self,
        expected_version: u64,
        next: DynamicState,
    ) -> Result<(), CharacterLifeError> {
        self.require_version(expected_version)?;
        self.dynamic_state = next;
        self.stream_version += 1;
        Ok(())
    }

    /// `CommitmentRationaleSealed`: seals a structured, quote-free rationale.
    ///
    /// # Errors
    ///
    /// Rejects a stale expected version or a second concurrently open
    /// thesis (`docs/v5/character-story-engine.md`: "人物不能靜默修改原始理由").
    pub fn seal_commitment_rationale(
        &mut self,
        expected_version: u64,
        rationale: CommitmentRationale,
    ) -> Result<(), CharacterLifeError> {
        self.require_version(expected_version)?;
        if self.open_thesis.is_some() {
            return Err(CharacterLifeError::ThesisAlreadyOpen);
        }
        self.open_thesis = Some(rationale);
        self.stream_version += 1;
        Ok(())
    }

    /// Closes the open thesis after its outcome is recognized
    /// (`PaperOutcomeRecognized` in the sibling `panshi-paper-ledger` crate
    /// drives this transition from the command-handler layer).
    ///
    /// # Errors
    ///
    /// Rejects a stale expected version or no open thesis.
    pub fn close_thesis(&mut self, expected_version: u64) -> Result<(), CharacterLifeError> {
        self.require_version(expected_version)?;
        if self.open_thesis.take().is_none() {
            return Err(CharacterLifeError::NoOpenThesis);
        }
        self.stream_version += 1;
        Ok(())
    }

    const fn require_version(&self, expected_version: u64) -> Result<(), CharacterLifeError> {
        if self.stream_version != expected_version {
            return Err(CharacterLifeError::WrongVersion {
                expected: expected_version,
                actual: self.stream_version,
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{CharacterLife, CharacterLifeError, CommitmentRationale, DynamicState};
    use panshi_decision_kernel::Fixed;

    fn rationale() -> CommitmentRationale {
        CommitmentRationale {
            thesis_id: [1; 16],
            security_id_hash: [2; 32],
            opened_at_unix_micros: 1_000,
            intended_horizon_unix_micros: 2_000,
            confidence: Fixed::from_raw(500_000),
            invalidation_condition_code: "two_session_momentum_expired",
        }
    }

    #[test]
    fn rationale_cannot_be_sealed_twice_while_open() {
        let mut life = CharacterLife::new([9; 16]);
        life.seal_commitment_rationale(0, rationale())
            .expect("first seal");
        assert_eq!(
            life.seal_commitment_rationale(1, rationale()),
            Err(CharacterLifeError::ThesisAlreadyOpen)
        );
    }

    #[test]
    fn stale_version_is_rejected() {
        let mut life = CharacterLife::new([9; 16]);
        assert_eq!(
            life.seal_commitment_rationale(5, rationale()),
            Err(CharacterLifeError::WrongVersion {
                expected: 5,
                actual: 0
            })
        );
    }

    #[test]
    fn closing_without_an_open_thesis_is_rejected() {
        let mut life = CharacterLife::new([9; 16]);
        assert_eq!(
            life.close_thesis(0),
            Err(CharacterLifeError::NoOpenThesis)
        );
    }

    #[test]
    fn state_advances_and_thesis_closes_across_versions() {
        let mut life = CharacterLife::new([9; 16]);
        life.advance_state(
            0,
            DynamicState {
                fomo_bp: 4_600,
                ..DynamicState::NEUTRAL
            },
        )
        .expect("advance");
        assert_eq!(life.stream_version, 1);
        life.seal_commitment_rationale(1, rationale())
            .expect("seal");
        assert_eq!(life.stream_version, 2);
        life.close_thesis(2).expect("close");
        assert_eq!(life.stream_version, 3);
        assert!(life.open_thesis.is_none());
    }
}
