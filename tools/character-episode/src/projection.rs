//! Minimal, honest read-model projections folded directly from the
//! canonical event log, proving `docs/v5/system-design.md` §19 Phase 2's
//! "close-up, life-journal, and portfolio projection" requirement at the
//! scope this one-character slice actually needs. A full projection-worker
//! service (`services/projection-worker`) with persistent, incrementally
//! updated read-model tables is out of scope for Phase 2 -- these functions
//! instead fold the *entire* ordered canonical log into a fresh struct every
//! call, which is itself the strongest form of "rebuild from an empty
//! projection database" (there is no carried-over state to even reset).
//!
//! Per `docs/v5/system-design.md` §11.3, every projection response carries
//! `data_state`/`visibility_epoch`/`truth_classes`/`source_revision_set`;
//! this module models only the domain-specific fields, since the envelope
//! fields are a presentation/API concern layered on top (see
//! `contracts/openapi/public-v2.yaml`), not a replay-fidelity concern.

use panshi_protocol::{character, decode_canonical, portfolio, story};

/// One decoded canonical event, as read back from `event_store.events`
/// (or, in a native-only test, taken directly from `GoldenEpisode`).
#[derive(Clone, Debug)]
pub struct ReplayableEvent<'a> {
    pub event_type: &'a str,
    pub payload_bytes: &'a [u8],
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct CharacterCloseUpProjection {
    pub character_id: Option<Vec<u8>>,
    pub latest_dynamic_state: Option<character::v1::DynamicStateV1>,
    pub open_thesis_revision: Option<String>,
    pub latest_public_claim_text: Option<String>,
    pub latest_public_claim_artifact_id: Option<Vec<u8>>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct LifeJournalChapterSummary {
    pub chapter_id: Vec<u8>,
    pub published: bool,
    pub source_event_count: usize,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct LifeJournalProjection {
    pub chapters: Vec<LifeJournalChapterSummary>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct PortfolioProjection {
    pub cash_fixed: i64,
    pub position_quantity_fixed: i64,
    pub position_cost_basis_fixed: i64,
    pub last_fill_price_fixed: i64,
    pub order_count: usize,
}

/// Folds the ordered canonical log into all three projections in a single
/// pass. Unknown/irrelevant event types are ignored, matching the product
/// rule that projections never become a second source of canonical truth --
/// they only ever restate what a canonical event already said.
///
/// # Panics
///
/// Panics if a canonical event payload fails to decode as its own declared
/// message type, which would indicate corrupted or non-canonical persisted
/// bytes -- a defect this slice's own replay path should never produce.
#[must_use]
pub fn replay_projections(
    events: &[ReplayableEvent<'_>],
) -> (CharacterCloseUpProjection, LifeJournalProjection, PortfolioProjection) {
    let mut close_up = CharacterCloseUpProjection::default();
    let mut journal = LifeJournalProjection::default();
    let mut portfolio_projection = PortfolioProjection::default();

    for event in events {
        match event.event_type {
            "CharacterOriginSealed" => {
                let decoded = decode_canonical::<character::v1::CharacterOriginSealedV1>(event.payload_bytes)
                    .expect("canonical CharacterOriginSealedV1");
                close_up.character_id = Some(decoded.character_id);
            }
            "CharacterStateAdvanced" => {
                let decoded = decode_canonical::<character::v1::CharacterStateAdvancedV1>(event.payload_bytes)
                    .expect("canonical CharacterStateAdvancedV1");
                close_up.latest_dynamic_state = decoded.next_state;
            }
            "AutonomousActionIntentCommitted" => {
                let decoded = decode_canonical::<character::v1::AutonomousActionIntentCommittedV1>(
                    event.payload_bytes,
                )
                .expect("canonical AutonomousActionIntentCommittedV1");
                close_up.open_thesis_revision = Some(decoded.thesis_revision);
            }
            "PublicClaimMade" => {
                let decoded = decode_canonical::<character::v1::UtteranceArtifactV1>(event.payload_bytes)
                    .expect("canonical UtteranceArtifactV1");
                close_up.latest_public_claim_text = Some(decoded.canonical_text_utf8);
                close_up.latest_public_claim_artifact_id = Some(decoded.utterance_artifact_id);
            }
            "StoryChapterComposed" => {
                let decoded = decode_canonical::<story::v1::StoryChapterComposedV1>(event.payload_bytes)
                    .expect("canonical StoryChapterComposedV1");
                let source_event_count = decoded
                    .source_set
                    .as_ref()
                    .map_or(0, |source_set| source_set.source_event_ids.len());
                journal.chapters.push(LifeJournalChapterSummary {
                    chapter_id: decoded.chapter_id,
                    published: false,
                    source_event_count,
                });
            }
            "StoryChapterPublished" => {
                let decoded = decode_canonical::<story::v1::StoryChapterPublishedV1>(event.payload_bytes)
                    .expect("canonical StoryChapterPublishedV1");
                if let Some(chapter) = journal
                    .chapters
                    .iter_mut()
                    .find(|chapter| chapter.chapter_id == decoded.chapter_id)
                {
                    chapter.published = true;
                }
            }
            "PaperAccountJournalPosted" => {
                let decoded =
                    decode_canonical::<portfolio::v1::PaperAccountJournalPostedV1>(event.payload_bytes)
                        .expect("canonical PaperAccountJournalPostedV1");
                portfolio_projection.cash_fixed = decoded.cash_after_fixed;
            }
            "PaperPositionOpened" => {
                let decoded = decode_canonical::<portfolio::v1::PaperPositionOpenedV1>(event.payload_bytes)
                    .expect("canonical PaperPositionOpenedV1");
                if let Some(lot) = decoded.initial_lot {
                    portfolio_projection.position_quantity_fixed = lot.quantity_fixed;
                    portfolio_projection.position_cost_basis_fixed = lot.cost_basis_fixed;
                }
            }
            "PaperOrderFilled" => {
                let decoded = decode_canonical::<portfolio::v1::PaperOrderFilledV1>(event.payload_bytes)
                    .expect("canonical PaperOrderFilledV1");
                if let Some(price_source) = decoded.price_source {
                    portfolio_projection.last_fill_price_fixed = price_source.sealed_price_fixed;
                }
            }
            "PaperOrderSubmitted" => {
                portfolio_projection.order_count += 1;
            }
            _ => {}
        }
    }

    (close_up, journal, portfolio_projection)
}

#[cfg(test)]
mod tests {
    use super::{ReplayableEvent, replay_projections};
    use crate::golden_episode;

    #[test]
    fn projections_rebuild_identically_from_two_independent_folds() {
        let episode = golden_episode();
        let events: Vec<ReplayableEvent<'_>> = episode
            .events
            .iter()
            .map(|event| ReplayableEvent {
                event_type: event.event_type,
                payload_bytes: &event.payload_bytes,
            })
            .collect();

        let (close_up_a, journal_a, portfolio_a) = replay_projections(&events);
        let (close_up_b, journal_b, portfolio_b) = replay_projections(&events);
        assert_eq!(close_up_a, close_up_b);
        assert_eq!(journal_a, journal_b);
        assert_eq!(portfolio_a, portfolio_b);
    }

    #[test]
    fn close_up_reflects_the_sealed_utterance_and_open_thesis() {
        let episode = golden_episode();
        let events: Vec<ReplayableEvent<'_>> = episode
            .events
            .iter()
            .map(|event| ReplayableEvent {
                event_type: event.event_type,
                payload_bytes: &event.payload_bytes,
            })
            .collect();
        let (close_up, journal, portfolio_projection) = replay_projections(&events);

        assert_eq!(close_up.character_id, Some(episode.ids.character_id.to_vec()));
        assert_eq!(close_up.open_thesis_revision.as_deref(), Some("thesis-v5-golden-001"));
        assert!(close_up.latest_public_claim_text.is_some());

        assert_eq!(journal.chapters.len(), 1);
        assert!(journal.chapters[0].published);
        assert!(journal.chapters[0].source_event_count > 0);

        assert!(portfolio_projection.position_quantity_fixed > 0);
        assert_eq!(portfolio_projection.order_count, 1);
        assert_eq!(
            portfolio_projection.last_fill_price_fixed,
            episode.market.sealed_reference_price.raw()
        );
    }

    #[test]
    fn projection_never_sees_more_than_the_canonical_log_it_was_given() {
        // An empty log yields an empty (default) projection -- there is no
        // hidden carried-over state a "rebuild from empty" could fail to
        // clear, because there is none to begin with.
        let (close_up, journal, portfolio_projection) = replay_projections(&[]);
        assert_eq!(close_up, super::CharacterCloseUpProjection::default());
        assert_eq!(journal, super::LifeJournalProjection::default());
        assert_eq!(portfolio_projection, super::PortfolioProjection::default());
    }
}
