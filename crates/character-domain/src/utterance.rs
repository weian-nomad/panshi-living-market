//! `UtteranceArtifact` (`docs/v5/system-design.md` §4: Character Life owns
//! `CharacterLife` *and* `UtteranceArtifact` as two separate aggregates).
//!
//! "A character speaks at most once per semantic speech act"
//! (`docs/v5/character-story-engine.md` "角色只說一次") is enforced at two
//! layers: this in-process guard (for command-handler-local reasoning and
//! tests), and -- the layer that actually matters under concurrency -- the
//! event-store stream CAS, by routing every `PublicClaimMade`/
//! `SelfAcknowledgementMade` event to a stream whose `stream_id` is
//! deterministically derived from `(semantic_speech_act_event_id,
//! surface_kind)` (see `stream_id_for` below and its use in the episode
//! runner). Two concurrent sealing attempts for the same act/surface race for
//! the same stream at `expected_version = 0`; only one wins.

use sha2::{Digest as _, Sha256};

use crate::{Digest, Id};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SurfaceKind {
    PublicSpeech,
    PublicWriting,
    SelfAcknowledged,
}

impl SurfaceKind {
    const fn tag_byte(self) -> u8 {
        match self {
            Self::PublicSpeech => 1,
            Self::PublicWriting => 2,
            Self::SelfAcknowledged => 3,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SealingEventType {
    PublicClaimMade,
    SelfAcknowledgementMade,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GenerationMode {
    Model,
    DeterministicFallback,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UtteranceArtifact {
    pub utterance_artifact_id: Id,
    pub character_id: Id,
    pub semantic_speech_act_event_id: Id,
    pub sealing_event_type: SealingEventType,
    pub surface_kind: SurfaceKind,
    pub canonical_text_utf8: String,
    pub canonical_text_sha256: Digest,
    pub generation_mode: GenerationMode,
    pub sealed_at_unix_micros: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UtteranceError {
    AlreadySealed,
}

impl UtteranceArtifact {
    /// The deterministic event-store `stream_id` for the
    /// `(semantic_speech_act_event_id, surface_kind)` uniqueness key. Uses
    /// the same `domain_digest`-style construction (tagged SHA-256, truncated
    /// to 16 bytes) as the rest of this codebase's canonical digests.
    #[must_use]
    pub fn stream_id_for(semantic_speech_act_event_id: Id, surface_kind: SurfaceKind) -> Id {
        let mut hasher = Sha256::new();
        hasher.update(b"PSZS/UTTERANCE_ARTIFACT_STREAM/v1\0");
        hasher.update(semantic_speech_act_event_id);
        hasher.update([surface_kind.tag_byte()]);
        let digest: [u8; 32] = hasher.finalize().into();
        let mut stream_id = [0_u8; 16];
        stream_id.copy_from_slice(&digest[..16]);
        stream_id
    }

    /// Normalizes to Unicode NFC + LF line endings and computes the
    /// canonical text hash
    /// (`docs/v5/character-story-engine.md`: "`canonicalTextUtf8` 經 NFC／LF
    /// 正規化，再計 `canonicalTextSha256`"). NFC normalization itself is not
    /// implemented in this crate (no Unicode normalization dependency has
    /// been added without a license/maintenance review); callers must pass
    /// already-NFC-normalized, LF-normalized text. This function only
    /// asserts the LF invariant and computes the hash, and documents the gap
    /// rather than silently skipping normalization.
    ///
    /// # Panics
    ///
    /// Panics if `text` contains a bare CR, which would indicate the caller
    /// skipped LF normalization.
    #[must_use]
    pub fn canonical_text_sha256(text: &str) -> Digest {
        assert!(!text.contains('\r'), "canonical text must be LF-normalized before hashing");
        let mut hasher = Sha256::new();
        hasher.update(b"PSZS/UTTERANCE_TEXT/v1\0");
        hasher.update(text.as_bytes());
        hasher.finalize().into()
    }

    /// Seals a new artifact, computing the canonical text hash. This
    /// constructor does not itself prevent a second call for the same
    /// `(semantic_speech_act_event_id, surface_kind)` -- see the module docs
    /// for why that guard belongs to the event-store layer.
    #[must_use]
    pub fn seal(request: SealUtteranceRequest) -> Self {
        let canonical_text_sha256 = Self::canonical_text_sha256(&request.canonical_text_utf8);
        Self {
            utterance_artifact_id: request.utterance_artifact_id,
            character_id: request.character_id,
            semantic_speech_act_event_id: request.semantic_speech_act_event_id,
            sealing_event_type: request.sealing_event_type,
            surface_kind: request.surface_kind,
            canonical_text_utf8: request.canonical_text_utf8,
            canonical_text_sha256,
            generation_mode: request.generation_mode,
            sealed_at_unix_micros: request.sealed_at_unix_micros,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SealUtteranceRequest {
    pub utterance_artifact_id: Id,
    pub character_id: Id,
    pub semantic_speech_act_event_id: Id,
    pub sealing_event_type: SealingEventType,
    pub surface_kind: SurfaceKind,
    pub canonical_text_utf8: String,
    pub generation_mode: GenerationMode,
    pub sealed_at_unix_micros: i64,
}

/// An in-process registry enforcing "one artifact per act/surface" for a
/// single command handler invocation or test, mirroring (but not replacing)
/// the event-store stream-CAS enforcement described in the module docs.
#[derive(Clone, Debug, Default)]
pub struct UtteranceRegistry {
    sealed_stream_ids: Vec<Id>,
}

impl UtteranceRegistry {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            sealed_stream_ids: Vec::new(),
        }
    }

    /// # Errors
    ///
    /// Rejects a second seal attempt for the same act/surface stream id.
    pub fn register_seal(&mut self, artifact: &UtteranceArtifact) -> Result<(), UtteranceError> {
        let stream_id =
            UtteranceArtifact::stream_id_for(artifact.semantic_speech_act_event_id, artifact.surface_kind);
        if self.sealed_stream_ids.contains(&stream_id) {
            return Err(UtteranceError::AlreadySealed);
        }
        self.sealed_stream_ids.push(stream_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        GenerationMode, SealUtteranceRequest, SealingEventType, SurfaceKind, UtteranceArtifact,
        UtteranceError, UtteranceRegistry,
    };

    #[test]
    fn stream_id_is_stable_and_distinguishes_surface_kind() {
        let a = UtteranceArtifact::stream_id_for([1; 16], SurfaceKind::PublicSpeech);
        let b = UtteranceArtifact::stream_id_for([1; 16], SurfaceKind::PublicSpeech);
        let c = UtteranceArtifact::stream_id_for([1; 16], SurfaceKind::SelfAcknowledged);
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn identical_text_produces_identical_hash_across_calls() {
        let first = UtteranceArtifact::canonical_text_sha256("only two days of drift, not a thesis");
        let second = UtteranceArtifact::canonical_text_sha256("only two days of drift, not a thesis");
        assert_eq!(first, second);
    }

    #[test]
    fn second_seal_for_the_same_act_and_surface_is_rejected() {
        let mut registry = UtteranceRegistry::new();
        let artifact = UtteranceArtifact::seal(SealUtteranceRequest {
            utterance_artifact_id: [1; 16],
            character_id: [2; 16],
            semantic_speech_act_event_id: [3; 16],
            sealing_event_type: SealingEventType::PublicClaimMade,
            surface_kind: SurfaceKind::PublicSpeech,
            canonical_text_utf8: "no new data, i am not moving".to_owned(),
            generation_mode: GenerationMode::DeterministicFallback,
            sealed_at_unix_micros: 1_000,
        });
        registry.register_seal(&artifact).expect("first registration");

        let duplicate = UtteranceArtifact::seal(SealUtteranceRequest {
            utterance_artifact_id: [9; 16],
            character_id: [2; 16],
            semantic_speech_act_event_id: [3; 16],
            sealing_event_type: SealingEventType::PublicClaimMade,
            surface_kind: SurfaceKind::PublicSpeech,
            canonical_text_utf8: "a late model result must not override this".to_owned(),
            generation_mode: GenerationMode::Model,
            sealed_at_unix_micros: 1_001,
        });
        assert_eq!(
            registry.register_seal(&duplicate),
            Err(UtteranceError::AlreadySealed)
        );
    }
}
