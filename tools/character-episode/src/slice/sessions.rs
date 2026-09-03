//! The six synthetic **historical** market sessions this slice consumes.
//!
//! This table is a verbatim mirror of the sealed fixture that
//! `contracts/world-fact-manifest/historical-v1/` owns:
//!
//! - `fixtures/synthetic-historical-001.json` (the six manifests)
//! - `fixtures/synthetic-historical-001-fact-revisions.json` (the nine fact
//!   revisions)
//!
//! Manifest ids, market session ids, fact revision ids, cutoffs, set digests
//! and availability times are copied field for field. This repository never
//! recomputes the upstream contract's digests -- it stores them as received
//! (`contracts/proto/panshi/world/v1/world.proto`), and the tests at the
//! bottom of this file are what keep the copy honest.
//!
//! Everything here is a fictional, repo-local fixture: no real security, no
//! real exchange session, no upstream ingest. Every fact carries
//! `truthClass: "fictional_setting"` and `provenanceClass:
//! "synthetic_fixture"` in the source contract, and it is never `real_fact`.
//! Labelling a synthesized close as a real fact would be a lie, and the
//! fail-closed rule covers provenance exactly as it covers freshness.
//!
//! Two cutoffs, deliberately different (`docs/v5/system-design.md` §6.2):
//! the **interaction** cutoff is the session open (09:00), so a character can
//! only ever reason from evidence that was already available when the session
//! began; the **evidence** cutoff is the close (13:30), which is when the
//! session's own sealed price and post-close editorial material land. That is
//! why a session's own close price is outcome evidence for that session and
//! only becomes interaction evidence on the next one.
//!
//! S1..S5 have accepted finality and each publishes one journal chapter. S6
//! is "today": its price revision is still `pending`, it carries no outcome
//! evidence at all, and it publishes no chapter. It exists so the slice can
//! show both sides of the finality fence on one screen.

use panshi_decision_kernel::Fixed;

/// Six-decimal fixed-point helper for the sealed close prices below.
const fn twd(units: i64, fractional_micros: i64) -> Fixed {
    Fixed::from_raw(units * Fixed::SCALE + fractional_micros)
}

/// Timestamps in this crate are Unix microseconds. Kept separate from
/// `Fixed::SCALE` on purpose: the two constants happen to share a value but
/// mean unrelated things.
const MICROS_PER_SECOND: i64 = 1_000_000;

const fn taipei(midnight_unix_micros: i64, hour: i64, minute: i64) -> i64 {
    midnight_unix_micros + (hour * 3_600 + minute * 60) * MICROS_PER_SECOND
}

// -- Midnight (00:00 UTC+8) for each market date -----------------------------

const MIDNIGHT_S1: i64 = 1_772_380_800_000_000; // 2026-03-02
const MIDNIGHT_S2: i64 = 1_772_467_200_000_000; // 2026-03-03
const MIDNIGHT_S3: i64 = 1_772_640_000_000_000; // 2026-03-05
const MIDNIGHT_S4: i64 = 1_773_072_000_000_000; // 2026-03-10
const MIDNIGHT_S5: i64 = 1_773_676_800_000_000; // 2026-03-17
const MIDNIGHT_S6: i64 = 1_773_763_200_000_000; // 2026-03-18

// -- Fact revision identifiers ------------------------------------------------
// One `const` per sealed fact revision in the upstream fixture, so nothing in
// this crate can reference a fact that does not exist there.

/// The early move on 2026-03-02 that he was not reading when it happened.
pub const FACT_MOMENTUM_S1: &str = "fact-hist-001-momentum-s1";

/// The counter-evidence: peer-group inventory days rising to 64.5. Published
/// at 10:15 on S1 -- after that session's 09:00 interaction cutoff, so it
/// first becomes attendable on S2 and stays attendable every session after.
/// Every session in which it lands in `missed` is therefore a choice made
/// with the fact in front of him, not information he lacked.
pub const FACT_COUNTER_INVENTORY: &str = "fact-hist-001-counter-inventory";

/// The issuer correction notice published mid-session on S4 -- after S4's
/// interaction cutoff, so it is S4 outcome evidence and S5 interaction
/// evidence.
pub const FACT_CORRECTION_S4: &str = "fact-hist-001-correction-s4";

pub const FACT_PRICE_S1: &str = "fact-hist-001-price-s1";
pub const FACT_PRICE_S2: &str = "fact-hist-001-price-s2";
pub const FACT_PRICE_S3: &str = "fact-hist-001-price-s3";
pub const FACT_PRICE_S4: &str = "fact-hist-001-price-s4";
pub const FACT_PRICE_S5: &str = "fact-hist-001-price-s5";
/// Today's price revision. `marketSessionFinalityState` is `pending`, so it
/// may not be used as a settled mark source.
pub const FACT_PRICE_S6: &str = "fact-hist-001-price-s6";

/// The single fictional demo instrument this slice trades on paper.
pub const SECURITY_ID: &str = "PSZS-DEMO";

pub const RIGHTS_MANIFEST_ID: &str = "rights_synthetic-historical.2026-03";
pub const FINALITY_POLICY_REVISION: &str = "historical-finality-policy.2026.rev1";
pub const EXECUTION_RULESET_REVISION: &str = "execution-ruleset/v1";

/// One sealed fact revision as the upstream fixture defines it.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SealedFact {
    pub fact_revision_id: &'static str,
    /// The manifest that first sealed this revision.
    pub manifest_id: &'static str,
    /// `max(worldPublishedAt, platformReceivedAt)`, matching
    /// `FactBecameVisibleV1.available_at_unix_micros`.
    pub available_at_unix_micros: i64,
}

pub const FACTS: [SealedFact; 9] = [
    SealedFact {
        fact_revision_id: FACT_MOMENTUM_S1,
        manifest_id: "wfm_hist_001_s1",
        available_at_unix_micros: taipei(MIDNIGHT_S1, 8, 47),
    },
    SealedFact {
        fact_revision_id: FACT_COUNTER_INVENTORY,
        manifest_id: "wfm_hist_001_s1",
        available_at_unix_micros: taipei(MIDNIGHT_S1, 10, 20),
    },
    SealedFact {
        fact_revision_id: FACT_PRICE_S1,
        manifest_id: "wfm_hist_001_s1",
        available_at_unix_micros: taipei(MIDNIGHT_S1, 13, 30),
    },
    SealedFact {
        fact_revision_id: FACT_PRICE_S2,
        manifest_id: "wfm_hist_001_s2",
        available_at_unix_micros: taipei(MIDNIGHT_S2, 13, 30),
    },
    SealedFact {
        fact_revision_id: FACT_PRICE_S3,
        manifest_id: "wfm_hist_001_s3",
        available_at_unix_micros: taipei(MIDNIGHT_S3, 13, 30),
    },
    SealedFact {
        fact_revision_id: FACT_CORRECTION_S4,
        manifest_id: "wfm_hist_001_s4",
        available_at_unix_micros: taipei(MIDNIGHT_S4, 11, 25),
    },
    SealedFact {
        fact_revision_id: FACT_PRICE_S4,
        manifest_id: "wfm_hist_001_s4",
        available_at_unix_micros: taipei(MIDNIGHT_S4, 13, 30),
    },
    SealedFact {
        fact_revision_id: FACT_PRICE_S5,
        manifest_id: "wfm_hist_001_s5",
        available_at_unix_micros: taipei(MIDNIGHT_S5, 13, 30),
    },
    SealedFact {
        fact_revision_id: FACT_PRICE_S6,
        manifest_id: "wfm_hist_001_s6",
        available_at_unix_micros: taipei(MIDNIGHT_S6, 8, 32),
    },
];

/// The availability time the upstream fixture sealed for `fact_revision_id`.
///
/// # Panics
///
/// Panics for an id that is not in the fixture. That is deliberate: a
/// canonical event must never be emitted against an unknown fact, and
/// inventing a timestamp for one would be exactly the fabrication the
/// fail-closed rule forbids.
#[must_use]
pub fn fact_available_at(fact_revision_id: &str) -> i64 {
    FACTS
        .iter()
        .find(|fact| fact.fact_revision_id == fact_revision_id)
        .unwrap_or_else(|| panic!("unknown sealed fact revision: {fact_revision_id}"))
        .available_at_unix_micros
}

// -- Session table -------------------------------------------------------------

/// One synthetic historical market session, mirroring one upstream manifest.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MarketSession {
    /// 1-based, matching the S1..S6 labels used across the V5 docs.
    pub session_index: usize,
    pub manifest_id: &'static str,
    pub market_session_id: &'static str,
    pub market_date_taipei: &'static str,
    /// Unix micros at 00:00 Taipei (UTC+8) on `market_date_taipei`.
    pub midnight_taipei_unix_micros: i64,
    /// Upstream `manifestHash`, hex, without the `sha256:` prefix.
    pub manifest_hash_hex: &'static str,
    /// Upstream `interactionFactRevisionIds`: what a character could attend
    /// to during this session.
    pub interaction_fact_revision_ids: &'static [&'static str],
    pub interaction_fact_set_digest_hex: &'static str,
    /// Upstream `outcomeEvidenceRevisionIds`: post-cutoff evidence, a
    /// physically separate allowlist that never enters cognition.
    pub outcome_evidence_revision_ids: &'static [&'static str],
    pub outcome_evidence_set_digest_hex: &'static str,
    /// Fact revisions this manifest seals for the first time.
    pub newly_visible_fact_revision_ids: &'static [&'static str],
    /// This session's own sealed close, from `fact-hist-001-price-sN`.
    pub sealed_close: Fixed,
    pub close_price_fact_revision_id: &'static str,
    /// Mirrors `price-sN.payload.marketSessionFinalityState == "accepted"`.
    /// `false` only for S6, whose price revision is still `pending`.
    pub finality_accepted: bool,
}

impl MarketSession {
    const fn at(&self, hour: i64, minute: i64) -> i64 {
        taipei(self.midnight_taipei_unix_micros, hour, minute)
    }

    /// 09:00 Taipei. Doubles as the upstream `interactionCutoffAt`: nothing
    /// that became available after the open may enter this session's
    /// cognition.
    #[must_use]
    pub const fn open_unix_micros(&self) -> i64 {
        self.at(9, 0)
    }

    /// Alias of [`Self::open_unix_micros`], named for the contract field it
    /// mirrors.
    #[must_use]
    pub const fn interaction_cutoff_unix_micros(&self) -> i64 {
        self.open_unix_micros()
    }

    /// 09:30 Taipei -- exposure registration.
    #[must_use]
    pub const fn observed_at_unix_micros(&self) -> i64 {
        self.at(9, 30)
    }

    /// 10:00 Taipei -- cognition input seal.
    #[must_use]
    pub const fn input_sealed_at_unix_micros(&self) -> i64 {
        self.at(10, 0)
    }

    /// 10:30 Taipei -- appraisal, attention and action intent.
    #[must_use]
    pub const fn decision_at_unix_micros(&self) -> i64 {
        self.at(10, 30)
    }

    /// 10:40 Taipei -- semantic speech act and its sealed utterance.
    #[must_use]
    pub const fn speech_at_unix_micros(&self) -> i64 {
        self.at(10, 40)
    }

    /// 10:42 Taipei -- the paper order commit time in the worked example.
    #[must_use]
    pub const fn order_committed_at_unix_micros(&self) -> i64 {
        self.at(10, 42)
    }

    /// 13:30 Taipei -- the close, and the upstream `evidenceCutoffAt`.
    #[must_use]
    pub const fn close_unix_micros(&self) -> i64 {
        self.at(13, 30)
    }

    /// Alias of [`Self::close_unix_micros`], named for the contract field it
    /// mirrors.
    #[must_use]
    pub const fn evidence_cutoff_unix_micros(&self) -> i64 {
        self.close_unix_micros()
    }

    /// 14:30 Taipei -- when finality is accepted for S1..S5.
    #[must_use]
    pub const fn finality_accepted_at_unix_micros(&self) -> i64 {
        self.at(14, 30)
    }

    /// 15:00 Taipei -- the upstream `sealedAt`, and the moment the thesis
    /// chain's invalidation condition is evaluated for this session: only a
    /// settled session can say a horizon has passed.
    #[must_use]
    pub const fn chapter_composed_at_unix_micros(&self) -> i64 {
        self.at(15, 0)
    }

    /// 15:05 Taipei -- chapter publication.
    #[must_use]
    pub const fn chapter_published_at_unix_micros(&self) -> i64 {
        self.at(15, 5)
    }

    /// The order expiry deadline: this session's close. An order that finds
    /// no eligible sealed price by then expires; it is never back-filled at a
    /// flattering intraday price.
    #[must_use]
    pub const fn order_expires_at_unix_micros(&self) -> i64 {
        self.close_unix_micros()
    }
}

pub const SESSION_COUNT: usize = 6;

const S1_INTERACTION: [&str; 1] = [FACT_MOMENTUM_S1];
const S1_OUTCOME: [&str; 3] = [FACT_MOMENTUM_S1, FACT_COUNTER_INVENTORY, FACT_PRICE_S1];
const S1_NEW: [&str; 3] = [FACT_MOMENTUM_S1, FACT_COUNTER_INVENTORY, FACT_PRICE_S1];

const S2_INTERACTION: [&str; 3] = [FACT_MOMENTUM_S1, FACT_COUNTER_INVENTORY, FACT_PRICE_S1];
const S2_OUTCOME: [&str; 1] = [FACT_PRICE_S2];
const S2_NEW: [&str; 1] = [FACT_PRICE_S2];

const S3_INTERACTION: [&str; 3] = [FACT_COUNTER_INVENTORY, FACT_PRICE_S1, FACT_PRICE_S2];
const S3_OUTCOME: [&str; 1] = [FACT_PRICE_S3];
const S3_NEW: [&str; 1] = [FACT_PRICE_S3];

const S4_INTERACTION: [&str; 3] = [FACT_COUNTER_INVENTORY, FACT_PRICE_S2, FACT_PRICE_S3];
const S4_OUTCOME: [&str; 2] = [FACT_CORRECTION_S4, FACT_PRICE_S4];
const S4_NEW: [&str; 2] = [FACT_CORRECTION_S4, FACT_PRICE_S4];

const S5_INTERACTION: [&str; 4] = [
    FACT_CORRECTION_S4,
    FACT_COUNTER_INVENTORY,
    FACT_PRICE_S3,
    FACT_PRICE_S4,
];
const S5_OUTCOME: [&str; 1] = [FACT_PRICE_S5];
const S5_NEW: [&str; 1] = [FACT_PRICE_S5];

const S6_INTERACTION: [&str; 4] = [
    FACT_CORRECTION_S4,
    FACT_COUNTER_INVENTORY,
    FACT_PRICE_S5,
    FACT_PRICE_S6,
];
/// Today has no outcome evidence at all: nothing about this session has
/// settled, so there is nothing to attribute an outcome to.
const S6_OUTCOME: [&str; 0] = [];
const S6_NEW: [&str; 1] = [FACT_PRICE_S6];

/// The frozen six-session fixture, mirroring
/// `contracts/world-fact-manifest/historical-v1/fixtures/synthetic-historical-001.json`.
pub const SESSIONS: [MarketSession; SESSION_COUNT] = [
    MarketSession {
        session_index: 1,
        manifest_id: "wfm_hist_001_s1",
        market_session_id: "session-hist-001-s1",
        market_date_taipei: "2026-03-02",
        midnight_taipei_unix_micros: MIDNIGHT_S1,
        manifest_hash_hex: "35143c6212487177bcc30dfac363df7985854af7548eea1218e4ebed0dabba72",
        interaction_fact_revision_ids: &S1_INTERACTION,
        interaction_fact_set_digest_hex:
            "58c621f0f172118b79929bdf2fd33852b5b45252615606b2a0e39d079d57322c",
        outcome_evidence_revision_ids: &S1_OUTCOME,
        outcome_evidence_set_digest_hex:
            "9baeaf9f230e8488606be97c3bf002236dcc6e8cb762b88cc0c92f1c7847a289",
        newly_visible_fact_revision_ids: &S1_NEW,
        sealed_close: twd(96, 0),
        close_price_fact_revision_id: FACT_PRICE_S1,
        finality_accepted: true,
    },
    MarketSession {
        session_index: 2,
        manifest_id: "wfm_hist_001_s2",
        market_session_id: "session-hist-001-s2",
        market_date_taipei: "2026-03-03",
        midnight_taipei_unix_micros: MIDNIGHT_S2,
        manifest_hash_hex: "8ce7af7a463e83b9557ff47221f2b117986269cfd8cffa3216cdd0373b93e4a5",
        interaction_fact_revision_ids: &S2_INTERACTION,
        interaction_fact_set_digest_hex:
            "9baeaf9f230e8488606be97c3bf002236dcc6e8cb762b88cc0c92f1c7847a289",
        outcome_evidence_revision_ids: &S2_OUTCOME,
        outcome_evidence_set_digest_hex:
            "8295822971eac32ce2791f857bed2879f1d189274d369560e8a1de75cb35d9fc",
        newly_visible_fact_revision_ids: &S2_NEW,
        sealed_close: twd(100, 0),
        close_price_fact_revision_id: FACT_PRICE_S2,
        finality_accepted: true,
    },
    MarketSession {
        session_index: 3,
        manifest_id: "wfm_hist_001_s3",
        market_session_id: "session-hist-001-s3",
        market_date_taipei: "2026-03-05",
        midnight_taipei_unix_micros: MIDNIGHT_S3,
        manifest_hash_hex: "3a75d88fcc5a00e3f40955584888f2d7dc43be0ce86991d3a7518cda7da78f53",
        interaction_fact_revision_ids: &S3_INTERACTION,
        interaction_fact_set_digest_hex:
            "932bcf3fe8e84d27d23f389c5b785d00a812e0c9f7b45c62603499a1fcdf9424",
        outcome_evidence_revision_ids: &S3_OUTCOME,
        outcome_evidence_set_digest_hex:
            "a3e4b2b3b01b529c5cc19c4f8e359f2c68d41a5cc47397d34e7310877b5906a0",
        newly_visible_fact_revision_ids: &S3_NEW,
        sealed_close: twd(93, 500_000),
        close_price_fact_revision_id: FACT_PRICE_S3,
        finality_accepted: true,
    },
    MarketSession {
        session_index: 4,
        manifest_id: "wfm_hist_001_s4",
        market_session_id: "session-hist-001-s4",
        market_date_taipei: "2026-03-10",
        midnight_taipei_unix_micros: MIDNIGHT_S4,
        manifest_hash_hex: "b13e59d8f136d7f293cb66f5577c62143f07766d1cfa1be432535ce8b034405c",
        interaction_fact_revision_ids: &S4_INTERACTION,
        interaction_fact_set_digest_hex:
            "c0d28885a9e980246be82cf3890aa01cf7783e2cc5a1769b8939e4cc5fffae03",
        outcome_evidence_revision_ids: &S4_OUTCOME,
        outcome_evidence_set_digest_hex:
            "2d578c0eacfe42d64fafd178b4a5eefaa69334d2c4e82003482d570391fd12a2",
        newly_visible_fact_revision_ids: &S4_NEW,
        sealed_close: twd(91, 600_000),
        close_price_fact_revision_id: FACT_PRICE_S4,
        finality_accepted: true,
    },
    MarketSession {
        session_index: 5,
        manifest_id: "wfm_hist_001_s5",
        market_session_id: "session-hist-001-s5",
        market_date_taipei: "2026-03-17",
        midnight_taipei_unix_micros: MIDNIGHT_S5,
        manifest_hash_hex: "0213274df5a653aefe4a93fa1df9bb81d61bd5085cc0357f152f276f6dcbc803",
        interaction_fact_revision_ids: &S5_INTERACTION,
        interaction_fact_set_digest_hex:
            "a57473e7cf5672d12022b97ad46cdfb58fcc6336627c49e068b9b4c2c2393aa7",
        outcome_evidence_revision_ids: &S5_OUTCOME,
        outcome_evidence_set_digest_hex:
            "1c735e62ce5e1767570ece17954014fc5894407809b54fe1727d3dd94ebc8342",
        newly_visible_fact_revision_ids: &S5_NEW,
        sealed_close: twd(88, 200_000),
        close_price_fact_revision_id: FACT_PRICE_S5,
        finality_accepted: true,
    },
    // "Today". `fact-hist-001-price-s6` exists and reads 88.20, but its
    // `marketSessionFinalityState` is `pending`, so it may not be used as a
    // settled mark source; the slice marks against S5's accepted close and
    // labels the number as of the previous session. This session publishes no
    // chapter and discloses no same-day action.
    MarketSession {
        session_index: 6,
        manifest_id: "wfm_hist_001_s6",
        market_session_id: "session-hist-001-s6",
        market_date_taipei: "2026-03-18",
        midnight_taipei_unix_micros: MIDNIGHT_S6,
        manifest_hash_hex: "07ec8b90e65be2d16eda60d4ca377955035c2d313f5e938a5b5b7d20a0b71aa5",
        interaction_fact_revision_ids: &S6_INTERACTION,
        interaction_fact_set_digest_hex:
            "8d50af7d6be140a641a2dab0ec14e8381d8e31d5867a5b4c09aa4cf57b71a1d7",
        outcome_evidence_revision_ids: &S6_OUTCOME,
        outcome_evidence_set_digest_hex:
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        newly_visible_fact_revision_ids: &S6_NEW,
        sealed_close: twd(88, 200_000),
        close_price_fact_revision_id: FACT_PRICE_S6,
        finality_accepted: false,
    },
];

/// The last session whose price may be presented as settled -- the source of
/// the "截至前一交易日收盤（2026-03-17）" label the close-up carries.
pub const LAST_FINAL_SESSION_INDEX: usize = 5;

/// The last session with accepted finality.
#[must_use]
pub fn last_final_session() -> &'static MarketSession {
    &SESSIONS[LAST_FINAL_SESSION_INDEX - 1]
}

#[cfg(test)]
mod tests {
    use super::{
        FACTS, LAST_FINAL_SESSION_INDEX, SESSIONS, SESSION_COUNT, fact_available_at,
        last_final_session,
    };
    use panshi_decision_kernel::Fixed;

    #[test]
    fn session_indices_are_one_based_and_dense() {
        for (position, session) in SESSIONS.iter().enumerate() {
            assert_eq!(session.session_index, position + 1);
        }
        assert_eq!(SESSIONS.len(), SESSION_COUNT);
    }

    #[test]
    fn sessions_move_strictly_forward_in_time() {
        for pair in SESSIONS.windows(2) {
            assert!(
                pair[0].midnight_taipei_unix_micros < pair[1].midnight_taipei_unix_micros,
                "session dates must increase"
            );
        }
    }

    #[test]
    fn only_the_final_session_is_still_pending() {
        let accepted: Vec<usize> = SESSIONS
            .iter()
            .filter(|session| session.finality_accepted)
            .map(|session| session.session_index)
            .collect();
        assert_eq!(accepted, vec![1, 2, 3, 4, 5]);
        assert_eq!(accepted.len(), LAST_FINAL_SESSION_INDEX);
        assert_eq!(last_final_session().market_date_taipei, "2026-03-17");
        // Today has no outcome evidence at all.
        assert!(SESSIONS[5].outcome_evidence_revision_ids.is_empty());
    }

    #[test]
    fn sealed_closes_match_the_frozen_fixture() {
        let closes: Vec<i64> = SESSIONS
            .iter()
            .map(|session| session.sealed_close.raw())
            .collect();
        assert_eq!(
            closes,
            vec![
                96 * Fixed::SCALE,
                100 * Fixed::SCALE,
                93 * Fixed::SCALE + 500_000,
                91 * Fixed::SCALE + 600_000,
                88 * Fixed::SCALE + 200_000,
                88 * Fixed::SCALE + 200_000,
            ]
        );
    }

    #[test]
    fn intra_session_times_are_ordered() {
        for session in &SESSIONS {
            assert!(session.open_unix_micros() < session.observed_at_unix_micros());
            assert!(session.observed_at_unix_micros() < session.input_sealed_at_unix_micros());
            assert!(session.input_sealed_at_unix_micros() < session.decision_at_unix_micros());
            assert!(session.order_committed_at_unix_micros() < session.close_unix_micros());
            assert!(session.close_unix_micros() < session.finality_accepted_at_unix_micros());
            assert!(
                session.finality_accepted_at_unix_micros()
                    < session.chapter_composed_at_unix_micros()
            );
            assert!(session.interaction_cutoff_unix_micros() < session.evidence_cutoff_unix_micros());
        }
    }

    /// The fence that actually matters: a session's own sealed close is
    /// outcome evidence for that session and is never in the same session's
    /// interaction allowlist. A character can never act on today's close
    /// during today. (The two allowlists are separate lists, not disjoint
    /// sets -- a pre-open fact legitimately appears in both.)
    #[test]
    fn a_sessions_own_close_is_outcome_evidence_and_never_its_own_interaction_evidence() {
        for session in SESSIONS.iter().filter(|session| session.finality_accepted) {
            assert!(
                session
                    .outcome_evidence_revision_ids
                    .contains(&session.close_price_fact_revision_id),
                "{} must carry its own close as outcome evidence",
                session.manifest_id
            );
            assert!(
                !session
                    .interaction_fact_revision_ids
                    .contains(&session.close_price_fact_revision_id),
                "{} must not let its own close into cognition",
                session.manifest_id
            );
        }
    }

    /// Every interaction fact was available before its session's open. This
    /// is the invariant that makes the upstream fixture's allowlists
    /// mechanically checkable from this side, instead of trusted.
    #[test]
    fn every_interaction_fact_was_available_before_its_session_opened() {
        for session in &SESSIONS {
            for fact in session.interaction_fact_revision_ids {
                assert!(
                    fact_available_at(fact) <= session.interaction_cutoff_unix_micros(),
                    "{fact} became available after {} opened",
                    session.manifest_id
                );
            }
        }
    }

    /// Every fact that landed after a session opened is excluded from that
    /// session's cognition and appears only as outcome evidence -- the S4
    /// correction notice (11:25) is the load-bearing case: he could not have
    /// read it when he decided at 10:30, and the fixture must not pretend
    /// otherwise.
    #[test]
    fn post_open_facts_never_enter_the_same_sessions_cognition() {
        for session in &SESSIONS {
            for fact in session.newly_visible_fact_revision_ids {
                if fact_available_at(fact) > session.interaction_cutoff_unix_micros() {
                    assert!(
                        !session.interaction_fact_revision_ids.contains(fact),
                        "{fact} landed after {} opened and must stay out of cognition",
                        session.manifest_id
                    );
                }
            }
        }
        assert!(
            !SESSIONS[3]
                .interaction_fact_revision_ids
                .contains(&super::FACT_CORRECTION_S4)
        );
        assert!(
            SESSIONS[4]
                .interaction_fact_revision_ids
                .contains(&super::FACT_CORRECTION_S4)
        );
    }

    #[test]
    fn every_referenced_fact_exists_in_the_fixture() {
        for session in &SESSIONS {
            for fact in session
                .interaction_fact_revision_ids
                .iter()
                .chain(session.outcome_evidence_revision_ids)
                .chain(session.newly_visible_fact_revision_ids)
            {
                assert!(
                    FACTS
                        .iter()
                        .any(|sealed| sealed.fact_revision_id == *fact),
                    "{fact} is not in the sealed fixture"
                );
            }
        }
        // Each of the nine revisions becomes visible exactly once.
        let visible: Vec<&str> = SESSIONS
            .iter()
            .flat_map(|session| session.newly_visible_fact_revision_ids.iter().copied())
            .collect();
        assert_eq!(visible.len(), FACTS.len());
        for fact in &FACTS {
            assert_eq!(
                visible
                    .iter()
                    .filter(|id| **id == fact.fact_revision_id)
                    .count(),
                1
            );
        }
    }

    #[test]
    fn digest_hex_strings_are_well_formed() {
        for session in &SESSIONS {
            for hex in [
                session.manifest_hash_hex,
                session.interaction_fact_set_digest_hex,
                session.outcome_evidence_set_digest_hex,
            ] {
                assert_eq!(hex.len(), 64, "sha256 hex is 64 characters");
                assert!(hex.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
            }
        }
    }
}
