//! `ModelGateway` contract (`docs/v5/system-design.md` "Model integration |
//! versioned model gateway | schema-first、queued、可取消、不可直寫 canonical
//! store" and §17 "Model 越權 | model gateway 無 canonical DB credential；所有
//! 輸出經 Rust validator").
//!
//! The contract has three parts, each enforced by types rather than by
//! convention:
//!
//! 1. **Input is a reference to an already-sealed cognition input only.**
//!    `SealedCognitionInput` has private fields and can be built only from a
//!    `CognitiveEpisode` whose input is sealed. It exposes the input digest,
//!    the sealed interaction fact allowlist, the interaction cutoff, and the
//!    input/output schema revisions -- nothing else (no memory text, no
//!    ledger, no clock, no free prompt).
//! 2. **Output is a schema appraisal or a typed failure.** A gateway returns
//!    `SchemaAppraisal` or `GatewayFailure` (`Timeout`, `SchemaInvalid`,
//!    `TextOutput`). Free prose has no representation here at all.
//! 3. **No write handle.** `ModelGateway::appraise` takes `&self` and a
//!    shared reference to the sealed input; neither the trait nor any type in
//!    this module holds, borrows, or returns an event store, a database
//!    connection, a `CognitiveEpisode` `&mut`, or any other write capability.
//!    This crate has no `panshi-event-store`/`sqlx`/`tokio` dependency at all
//!    (`gateway_contract_carries_no_write_handle` checks both). Committing the
//!    resolved appraisal is the Cognition command handler's job, via
//!    `CognitiveEpisode::resolve_appraisal`, which accepts exactly one
//!    resolution per episode.
//!
//! `resolve_appraisal_once` calls the gateway at most once per request. Any
//! failure -- or no gateway at all (`NoNetwork`) -- routes to the versioned
//! deterministic fallback (`CoreAppraisalFallbackUsed`); it never retries for
//! a "better" result, and a late model result cannot replace a fallback
//! once `CognitiveEpisode::resolve_appraisal` has sealed it.
//!
//! A `SealedCognitionInput` cannot be assembled by hand, only from a sealed
//! episode:
//!
//! ```compile_fail,E0451
//! use panshi_character_domain::gateway::SealedCognitionInput;
//! let forged = SealedCognitionInput {
//!     input_digest: [0; 32],
//!     fact_allowlist: &[],
//!     interaction_cutoff_unix_micros: 0,
//!     input_schema_revision: "x",
//!     output_schema_revision: "y",
//! };
//! ```

use crate::Digest;
use crate::cognition::{
    AppraisalRef, AppraisalSource, CognitiveEpisode, CognitiveEpisodeError, CognitiveEpisodeState,
};
use crate::fallback::{
    FallbackAppraisal, deterministic_appraisal_fallback, fallback_appraisal_digest,
};

/// The input and output schema revisions a gateway call is pinned to.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SchemaRevisions {
    pub input_schema_revision: &'static str,
    pub output_schema_revision: &'static str,
}

/// A read-only reference to one sealed cognition input. Private fields: the
/// only constructor is `from_sealed_episode`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SealedCognitionInput<'a> {
    input_digest: Digest,
    fact_allowlist: &'a [String],
    interaction_cutoff_unix_micros: i64,
    input_schema_revision: &'static str,
    output_schema_revision: &'static str,
}

impl<'a> SealedCognitionInput<'a> {
    /// # Errors
    ///
    /// `WrongState` unless the episode is exactly `InputSealed`: an unsealed
    /// input may still change, and a resolved one must not be appraised
    /// again.
    pub fn from_sealed_episode(
        episode: &'a CognitiveEpisode,
        schema: SchemaRevisions,
    ) -> Result<Self, CognitiveEpisodeError> {
        match (episode.state, episode.input_digest) {
            (CognitiveEpisodeState::InputSealed, Some(input_digest)) => Ok(Self {
                input_digest,
                fact_allowlist: &episode.sealed_fact_revision_ids,
                interaction_cutoff_unix_micros: episode.interaction_cutoff_unix_micros,
                input_schema_revision: schema.input_schema_revision,
                output_schema_revision: schema.output_schema_revision,
            }),
            _ => Err(CognitiveEpisodeError::WrongState),
        }
    }

    #[must_use]
    pub const fn input_digest(&self) -> Digest {
        self.input_digest
    }

    #[must_use]
    pub const fn fact_allowlist(&self) -> &'a [String] {
        self.fact_allowlist
    }

    #[must_use]
    pub const fn interaction_cutoff_unix_micros(&self) -> i64 {
        self.interaction_cutoff_unix_micros
    }

    #[must_use]
    pub const fn input_schema_revision(&self) -> &'static str {
        self.input_schema_revision
    }

    #[must_use]
    pub const fn output_schema_revision(&self) -> &'static str {
        self.output_schema_revision
    }
}

/// One fact appraisal inside a schema appraisal (mirrors
/// `CognitionAppraisalV1.fact_appraisals`, basis points only).
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SchemaFactAppraisal {
    pub fact_revision_id: String,
    pub relevance_bp: i32,
    pub reliability_bp: i32,
    pub uncertainty_bp: i32,
}

/// The only successful gateway output: structured, schema-pinned, no prose.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SchemaAppraisal {
    pub output_schema_revision: String,
    pub fact_appraisals: Vec<SchemaFactAppraisal>,
}

/// The only failure shapes a gateway may report.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GatewayFailure {
    Timeout,
    SchemaInvalid,
    /// The model answered with free text instead of the schema.
    TextOutput,
}

/// Why the deterministic fallback was used (maps onto
/// `FallbackReasonCode` at the wire boundary).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FallbackReason {
    NoNetwork,
    TransportTimeout,
    SchemaInvalid,
    ReferencesUnknownFact,
    TextOutput,
}

/// A versioned model gateway. Implementations receive only a shared
/// reference to a sealed input and return only a schema appraisal or a
/// typed failure; they hold no event store, database, or episode write
/// handle, and nothing they return can commit canonical state.
pub trait ModelGateway {
    /// # Errors
    ///
    /// A typed `GatewayFailure`; the caller routes every failure to the
    /// deterministic fallback without retrying.
    fn appraise(&self, input: &SealedCognitionInput<'_>)
    -> Result<SchemaAppraisal, GatewayFailure>;
}

/// The deterministic, no-network fallback path (`NO_NETWORK`,
/// `CoreAppraisalFallbackUsed`). It is not a `ModelGateway`: it cannot fail
/// and never claims to be a model output.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct DeterministicFallbackGateway;

impl DeterministicFallbackGateway {
    #[must_use]
    pub fn appraise(self, input: &SealedCognitionInput<'_>) -> FallbackAppraisal {
        deterministic_appraisal_fallback(input.fact_allowlist().to_vec())
    }
}

/// The single resolution of one appraisal request.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AppraisalResolution {
    ModelAccepted(SchemaAppraisal),
    FallbackUsed {
        appraisal: FallbackAppraisal,
        reason: FallbackReason,
    },
}

impl AppraisalResolution {
    /// The ref `CognitiveEpisode::resolve_appraisal` seals.
    #[must_use]
    pub fn appraisal_ref(&self) -> AppraisalRef {
        match self {
            Self::ModelAccepted(appraisal) => AppraisalRef {
                source: AppraisalSource::ModelAccepted,
                appraisal_digest: schema_appraisal_digest(appraisal),
            },
            Self::FallbackUsed { appraisal, .. } => AppraisalRef {
                source: AppraisalSource::DeterministicFallback,
                appraisal_digest: fallback_appraisal_digest(appraisal),
            },
        }
    }
}

/// Calls `gateway` at most once. `None` means no network (the only path the
/// one-character slice runs). A failure, a wrong output schema revision, or
/// an appraisal of a fact outside the sealed allowlist all resolve to the
/// deterministic fallback -- there is no second attempt.
#[must_use]
pub fn resolve_appraisal_once(
    gateway: Option<&dyn ModelGateway>,
    input: &SealedCognitionInput<'_>,
) -> AppraisalResolution {
    let fallback = |reason| AppraisalResolution::FallbackUsed {
        appraisal: DeterministicFallbackGateway.appraise(input),
        reason,
    };
    let Some(gateway) = gateway else {
        return fallback(FallbackReason::NoNetwork);
    };
    match gateway.appraise(input) {
        Err(GatewayFailure::Timeout) => fallback(FallbackReason::TransportTimeout),
        Err(GatewayFailure::SchemaInvalid) => fallback(FallbackReason::SchemaInvalid),
        Err(GatewayFailure::TextOutput) => fallback(FallbackReason::TextOutput),
        Ok(appraisal) if appraisal.output_schema_revision != input.output_schema_revision() => {
            fallback(FallbackReason::SchemaInvalid)
        }
        Ok(appraisal)
            if !appraisal
                .fact_appraisals
                .iter()
                .all(|fact| input.fact_allowlist().contains(&fact.fact_revision_id)) =>
        {
            fallback(FallbackReason::ReferencesUnknownFact)
        }
        Ok(appraisal) => AppraisalResolution::ModelAccepted(appraisal),
    }
}

/// A stable digest over an accepted schema appraisal.
#[must_use]
pub fn schema_appraisal_digest(appraisal: &SchemaAppraisal) -> Digest {
    use sha2::{Digest as _, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(b"PSZS/SCHEMA_APPRAISAL/v1\0");
    hasher.update(appraisal.output_schema_revision.as_bytes());
    hasher.update([0]);
    for fact in &appraisal.fact_appraisals {
        hasher.update(fact.fact_revision_id.as_bytes());
        hasher.update([0]);
        hasher.update(fact.relevance_bp.to_be_bytes());
        hasher.update(fact.reliability_bp.to_be_bytes());
        hasher.update(fact.uncertainty_bp.to_be_bytes());
    }
    hasher.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::{
        AppraisalResolution, FallbackReason, GatewayFailure, ModelGateway, SchemaAppraisal,
        SchemaFactAppraisal, SchemaRevisions, SealedCognitionInput, resolve_appraisal_once,
    };
    use crate::cognition::{
        AppraisalSource, CandidateFact, CognitiveEpisode, CognitiveEpisodeError, SealInputRequest,
    };
    use std::cell::Cell;

    const SCHEMA: SchemaRevisions = SchemaRevisions {
        input_schema_revision: "cognition-input/v1",
        output_schema_revision: "cognition-appraisal/v1",
    };

    fn sealed_episode() -> CognitiveEpisode {
        let mut episode = CognitiveEpisode::open([1; 16], [2; 16], 1_000);
        episode.bind_manifest("wfm-gw-001").expect("bind");
        episode
            .seal_input(
                0,
                &SealInputRequest {
                    manifest_id: "wfm-gw-001",
                    candidate_facts: &[CandidateFact {
                        fact_revision_id: "fact-gw-001",
                        available_at_unix_micros: 100,
                    }],
                    character_world_time_unix_micros: 900,
                    sealed_at_unix_micros: 900,
                    input_digest: [3; 32],
                },
            )
            .expect("seal");
        episode
    }

    fn good_appraisal() -> SchemaAppraisal {
        SchemaAppraisal {
            output_schema_revision: SCHEMA.output_schema_revision.to_owned(),
            fact_appraisals: vec![SchemaFactAppraisal {
                fact_revision_id: "fact-gw-001".to_owned(),
                relevance_bp: 9_000,
                reliability_bp: 9_000,
                uncertainty_bp: 1_000,
            }],
        }
    }

    /// Fails on the first call and would return a "better" (more confident)
    /// appraisal on any later call -- so a retry would be observable.
    struct FlakyGateway {
        calls: Cell<u32>,
        first_failure: GatewayFailure,
    }

    impl ModelGateway for FlakyGateway {
        fn appraise(
            &self,
            _input: &SealedCognitionInput<'_>,
        ) -> Result<SchemaAppraisal, GatewayFailure> {
            let call = self.calls.get() + 1;
            self.calls.set(call);
            if call == 1 {
                Err(self.first_failure)
            } else {
                Ok(good_appraisal())
            }
        }
    }

    #[test]
    fn gateway_failure_routes_to_fallback_without_retry_for_better_result() {
        for (failure, reason) in [
            (GatewayFailure::Timeout, FallbackReason::TransportTimeout),
            (GatewayFailure::SchemaInvalid, FallbackReason::SchemaInvalid),
            (GatewayFailure::TextOutput, FallbackReason::TextOutput),
        ] {
            let mut episode = sealed_episode();
            let gateway = FlakyGateway {
                calls: Cell::new(0),
                first_failure: failure,
            };
            let resolution = {
                let input =
                    SealedCognitionInput::from_sealed_episode(&episode, SCHEMA).expect("sealed");
                resolve_appraisal_once(Some(&gateway), &input)
            };
            assert_eq!(gateway.calls.get(), 1, "exactly one gateway call, no retry");
            let AppraisalResolution::FallbackUsed {
                reason: actual_reason,
                ref appraisal,
            } = resolution
            else {
                panic!("a failed request must resolve to the fallback");
            };
            assert_eq!(actual_reason, reason);
            assert_eq!(appraisal.fact_revision_ids, vec!["fact-gw-001".to_owned()]);
            let fallback_ref = resolution.appraisal_ref();
            assert_eq!(fallback_ref.source, AppraisalSource::DeterministicFallback);
            episode
                .resolve_appraisal(1, fallback_ref)
                .expect("fallback sealed");

            // The "better" result arrives late (a second call now succeeds).
            // It cannot be requested through the sealed-input path any more,
            // and it cannot overwrite the sealed fallback.
            assert_eq!(
                SealedCognitionInput::from_sealed_episode(&episode, SCHEMA),
                Err(CognitiveEpisodeError::WrongState)
            );
            let late = AppraisalResolution::ModelAccepted(good_appraisal()).appraisal_ref();
            assert_eq!(
                episode.resolve_appraisal(2, late),
                Err(CognitiveEpisodeError::WrongState)
            );
            assert_eq!(
                episode.resolve_appraisal(1, late),
                Err(CognitiveEpisodeError::VersionConflict {
                    expected: 1,
                    actual: 2
                })
            );
            assert_eq!(episode.appraisal, Some(fallback_ref));
        }
    }

    #[test]
    fn no_network_uses_the_deterministic_fallback() {
        let episode = sealed_episode();
        let input = SealedCognitionInput::from_sealed_episode(&episode, SCHEMA).expect("sealed");
        let first = resolve_appraisal_once(None, &input);
        assert!(matches!(
            first,
            AppraisalResolution::FallbackUsed {
                reason: FallbackReason::NoNetwork,
                ..
            }
        ));
        assert_eq!(first, resolve_appraisal_once(None, &input));
    }

    struct FixedGateway(SchemaAppraisal);

    impl ModelGateway for FixedGateway {
        fn appraise(
            &self,
            _input: &SealedCognitionInput<'_>,
        ) -> Result<SchemaAppraisal, GatewayFailure> {
            Ok(self.0.clone())
        }
    }

    #[test]
    fn model_output_outside_the_sealed_allowlist_or_schema_falls_back() {
        let episode = sealed_episode();
        let input = SealedCognitionInput::from_sealed_episode(&episode, SCHEMA).expect("sealed");
        let accepted = resolve_appraisal_once(Some(&FixedGateway(good_appraisal())), &input);
        assert!(matches!(accepted, AppraisalResolution::ModelAccepted(_)));

        let mut unknown = good_appraisal();
        unknown.fact_appraisals[0].fact_revision_id = "fact-after-cutoff".to_owned();
        assert!(matches!(
            resolve_appraisal_once(Some(&FixedGateway(unknown)), &input),
            AppraisalResolution::FallbackUsed {
                reason: FallbackReason::ReferencesUnknownFact,
                ..
            }
        ));

        let mut wrong_schema = good_appraisal();
        wrong_schema.output_schema_revision = "cognition-appraisal/v0".to_owned();
        assert!(matches!(
            resolve_appraisal_once(Some(&FixedGateway(wrong_schema)), &input),
            AppraisalResolution::FallbackUsed {
                reason: FallbackReason::SchemaInvalid,
                ..
            }
        ));
    }

    #[test]
    fn unsealed_episode_cannot_be_offered_to_a_gateway() {
        let episode = CognitiveEpisode::open([1; 16], [2; 16], 1_000);
        assert_eq!(
            SealedCognitionInput::from_sealed_episode(&episode, SCHEMA),
            Err(CognitiveEpisodeError::WrongState)
        );
    }

    /// Compile-level contract: this coercion only type-checks while
    /// `appraise` takes `&self` plus a shared `&SealedCognitionInput` and
    /// returns `Result<SchemaAppraisal, GatewayFailure>` -- adding a write
    /// handle parameter, a `&mut self`, or a different output breaks the
    /// build. The dependency check below proves this crate cannot even name
    /// an event store or database handle.
    const APPRAISE_SIGNATURE: for<'g, 'i, 'a> fn(
        &'g dyn ModelGateway,
        &'i SealedCognitionInput<'a>,
    ) -> Result<SchemaAppraisal, GatewayFailure> = |gateway, input| gateway.appraise(input);

    #[test]
    fn gateway_contract_carries_no_write_handle() {
        let episode = sealed_episode();
        let input = SealedCognitionInput::from_sealed_episode(&episode, SCHEMA).expect("sealed");
        assert!(APPRAISE_SIGNATURE(&FixedGateway(good_appraisal()), &input).is_ok());

        let manifest = include_str!("../Cargo.toml");
        let dependencies = manifest
            .split("[dependencies]")
            .nth(1)
            .and_then(|rest| rest.split("\n[").next())
            .expect("[dependencies] section");
        for forbidden in [
            "event-store",
            "event_store",
            "sqlx",
            "tokio",
            "postgres",
            "reqwest",
        ] {
            assert!(
                !dependencies.contains(forbidden),
                "character-domain must not depend on {forbidden}"
            );
        }
    }
}
