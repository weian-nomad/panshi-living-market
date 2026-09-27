//! The thirty synthetic **historical** market sessions this slice consumes.
//!
//! This table is a verbatim mirror of the sealed fixture that
//! `contracts/world-fact-manifest/historical-v1/` owns:
//!
//! - `fixtures/synthetic-historical-001.json` (the thirty manifests)
//! - `fixtures/synthetic-historical-001-fact-revisions.json` (the
//!   thirty-three fact revisions)
//!
//! Manifest ids, market session ids, fact revision ids, cutoffs, set digests,
//! availability times and supersession links are copied field for field. The
//! table was written out by a generator, but that is not what keeps it
//! honest: `the_table_mirrors_the_sealed_json_fixture_field_for_field` at the
//! bottom of this file reads both JSON files with `include_str!` and compares
//! every mirrored field, so a hand edit on either side fails the build's
//! tests. This repository never recomputes the upstream contract's digests
//! -- it stores them as received (`contracts/proto/panshi/world/v1/world.proto`).
//!
//! Everything here is a fictional, repo-local fixture: no real security, no
//! real exchange session, no upstream ingest, and a synthetic trading
//! calendar (`synthetic-historical-calendar/v2`: consecutive weekdays from
//! 2026-03-02 minus two declared synthetic holidays). Every fact carries
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
//! S1..S29 have accepted finality and each publishes one journal chapter.
//! S30 is "today": its price revision is still `pending`, it carries no
//! outcome evidence at all, and it publishes no chapter. It exists so the
//! slice can show both sides of the finality fence on one screen.

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

pub const SESSION_COUNT: usize = 30;

// -- Fact revision identifiers ------------------------------------------------
// One `const` per sealed plot fact in the upstream fixture, plus the per
// session close table `FACT_PRICE`, so nothing in this crate can reference a
// fact that does not exist there. Ids embed the zero-padded session they
// originate in, so byte order is date order.

/// The early move on 2026-03-02 that he was not reading when it happened.
pub const FACT_MOMENTUM_S1: &str = "fact-hist-001-s01-momentum";

/// The counter-evidence: peer-group inventory days rising to 64.5. Published
/// at 10:15 on S1 -- after that session's 09:00 interaction cutoff, so it
/// first becomes attendable on S2 and stays attendable every session after.
/// Every session in which it lands in `missed` is therefore a choice made
/// with the fact in front of him, not information he lacked.
pub const FACT_COUNTER_INVENTORY: &str = "fact-hist-001-s01-counter-inventory";

/// The issuer correction notice published mid-session on S7 (2026-03-10):
/// it supersedes `FACT_MOMENTUM_S1`. It lands after S7's interaction cutoff,
/// so it is S7 outcome evidence and interaction evidence from S8 onward.
pub const FACT_ISSUER_CORRECTION: &str = "fact-hist-001-s07-correction";

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
    /// Upstream `supersedesFactRevisionId`: the earlier revision this one
    /// corrects. This is the only place the slice learns that a fact was
    /// later shown to be wrong -- it is never inferred from a price move.
    pub supersedes_fact_revision_id: Option<&'static str>,
}

// -- Midnight (00:00 UTC+8) for each market date -----------------------------

const MIDNIGHT: [i64; SESSION_COUNT] = [
    1_772_380_800_000_000, // 2026-03-02
    1_772_467_200_000_000, // 2026-03-03
    1_772_553_600_000_000, // 2026-03-04
    1_772_640_000_000_000, // 2026-03-05
    1_772_726_400_000_000, // 2026-03-06
    1_772_985_600_000_000, // 2026-03-09
    1_773_072_000_000_000, // 2026-03-10
    1_773_158_400_000_000, // 2026-03-11
    1_773_244_800_000_000, // 2026-03-12
    1_773_331_200_000_000, // 2026-03-13
    1_773_590_400_000_000, // 2026-03-16
    1_773_676_800_000_000, // 2026-03-17
    1_773_763_200_000_000, // 2026-03-18
    1_773_849_600_000_000, // 2026-03-19
    1_773_936_000_000_000, // 2026-03-20
    1_774_195_200_000_000, // 2026-03-23
    1_774_281_600_000_000, // 2026-03-24
    1_774_368_000_000_000, // 2026-03-25
    1_774_454_400_000_000, // 2026-03-26
    1_774_540_800_000_000, // 2026-03-27
    1_774_800_000_000_000, // 2026-03-30
    1_774_886_400_000_000, // 2026-03-31
    1_774_972_800_000_000, // 2026-04-01
    1_775_059_200_000_000, // 2026-04-02
    1_775_491_200_000_000, // 2026-04-07
    1_775_577_600_000_000, // 2026-04-08
    1_775_664_000_000_000, // 2026-04-09
    1_775_750_400_000_000, // 2026-04-10
    1_776_009_600_000_000, // 2026-04-13
    1_776_096_000_000_000, // 2026-04-14
];

/// The sealed close revision of each session, S1..S30 in order.
pub const FACT_PRICE: [&str; SESSION_COUNT] = [
    "fact-hist-001-s01-price",
    "fact-hist-001-s02-price",
    "fact-hist-001-s03-price",
    "fact-hist-001-s04-price",
    "fact-hist-001-s05-price",
    "fact-hist-001-s06-price",
    "fact-hist-001-s07-price",
    "fact-hist-001-s08-price",
    "fact-hist-001-s09-price",
    "fact-hist-001-s10-price",
    "fact-hist-001-s11-price",
    "fact-hist-001-s12-price",
    "fact-hist-001-s13-price",
    "fact-hist-001-s14-price",
    "fact-hist-001-s15-price",
    "fact-hist-001-s16-price",
    "fact-hist-001-s17-price",
    "fact-hist-001-s18-price",
    "fact-hist-001-s19-price",
    "fact-hist-001-s20-price",
    "fact-hist-001-s21-price",
    "fact-hist-001-s22-price",
    "fact-hist-001-s23-price",
    "fact-hist-001-s24-price",
    "fact-hist-001-s25-price",
    "fact-hist-001-s26-price",
    "fact-hist-001-s27-price",
    "fact-hist-001-s28-price",
    "fact-hist-001-s29-price",
    "fact-hist-001-s30-price",
];

pub const FACT_COUNT: usize = 33;

pub const FACTS: [SealedFact; FACT_COUNT] = [
    SealedFact {
        fact_revision_id: FACT_MOMENTUM_S1,
        manifest_id: "wfm_hist_001_s01",
        available_at_unix_micros: taipei(MIDNIGHT[0], 8, 47),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_COUNTER_INVENTORY,
        manifest_id: "wfm_hist_001_s01",
        available_at_unix_micros: taipei(MIDNIGHT[0], 10, 20),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[0],
        manifest_id: "wfm_hist_001_s01",
        available_at_unix_micros: taipei(MIDNIGHT[0], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[1],
        manifest_id: "wfm_hist_001_s02",
        available_at_unix_micros: taipei(MIDNIGHT[1], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[2],
        manifest_id: "wfm_hist_001_s03",
        available_at_unix_micros: taipei(MIDNIGHT[2], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[3],
        manifest_id: "wfm_hist_001_s04",
        available_at_unix_micros: taipei(MIDNIGHT[3], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[4],
        manifest_id: "wfm_hist_001_s05",
        available_at_unix_micros: taipei(MIDNIGHT[4], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[5],
        manifest_id: "wfm_hist_001_s06",
        available_at_unix_micros: taipei(MIDNIGHT[5], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_ISSUER_CORRECTION,
        manifest_id: "wfm_hist_001_s07",
        available_at_unix_micros: taipei(MIDNIGHT[6], 11, 25),
        supersedes_fact_revision_id: Some(FACT_MOMENTUM_S1),
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[6],
        manifest_id: "wfm_hist_001_s07",
        available_at_unix_micros: taipei(MIDNIGHT[6], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[7],
        manifest_id: "wfm_hist_001_s08",
        available_at_unix_micros: taipei(MIDNIGHT[7], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[8],
        manifest_id: "wfm_hist_001_s09",
        available_at_unix_micros: taipei(MIDNIGHT[8], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[9],
        manifest_id: "wfm_hist_001_s10",
        available_at_unix_micros: taipei(MIDNIGHT[9], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[10],
        manifest_id: "wfm_hist_001_s11",
        available_at_unix_micros: taipei(MIDNIGHT[10], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[11],
        manifest_id: "wfm_hist_001_s12",
        available_at_unix_micros: taipei(MIDNIGHT[11], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[12],
        manifest_id: "wfm_hist_001_s13",
        available_at_unix_micros: taipei(MIDNIGHT[12], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[13],
        manifest_id: "wfm_hist_001_s14",
        available_at_unix_micros: taipei(MIDNIGHT[13], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[14],
        manifest_id: "wfm_hist_001_s15",
        available_at_unix_micros: taipei(MIDNIGHT[14], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[15],
        manifest_id: "wfm_hist_001_s16",
        available_at_unix_micros: taipei(MIDNIGHT[15], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[16],
        manifest_id: "wfm_hist_001_s17",
        available_at_unix_micros: taipei(MIDNIGHT[16], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[17],
        manifest_id: "wfm_hist_001_s18",
        available_at_unix_micros: taipei(MIDNIGHT[17], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[18],
        manifest_id: "wfm_hist_001_s19",
        available_at_unix_micros: taipei(MIDNIGHT[18], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[19],
        manifest_id: "wfm_hist_001_s20",
        available_at_unix_micros: taipei(MIDNIGHT[19], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[20],
        manifest_id: "wfm_hist_001_s21",
        available_at_unix_micros: taipei(MIDNIGHT[20], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[21],
        manifest_id: "wfm_hist_001_s22",
        available_at_unix_micros: taipei(MIDNIGHT[21], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[22],
        manifest_id: "wfm_hist_001_s23",
        available_at_unix_micros: taipei(MIDNIGHT[22], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[23],
        manifest_id: "wfm_hist_001_s24",
        available_at_unix_micros: taipei(MIDNIGHT[23], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[24],
        manifest_id: "wfm_hist_001_s25",
        available_at_unix_micros: taipei(MIDNIGHT[24], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[25],
        manifest_id: "wfm_hist_001_s26",
        available_at_unix_micros: taipei(MIDNIGHT[25], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[26],
        manifest_id: "wfm_hist_001_s27",
        available_at_unix_micros: taipei(MIDNIGHT[26], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[27],
        manifest_id: "wfm_hist_001_s28",
        available_at_unix_micros: taipei(MIDNIGHT[27], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[28],
        manifest_id: "wfm_hist_001_s29",
        available_at_unix_micros: taipei(MIDNIGHT[28], 13, 30),
        supersedes_fact_revision_id: None,
    },
    SealedFact {
        fact_revision_id: FACT_PRICE[29],
        manifest_id: "wfm_hist_001_s30",
        available_at_unix_micros: taipei(MIDNIGHT[29], 8, 32),
        supersedes_fact_revision_id: None,
    },
];

/// The frozen thirty-session fixture, mirroring
/// `contracts/world-fact-manifest/historical-v1/fixtures/synthetic-historical-001.json`.
pub const SESSIONS: [MarketSession; SESSION_COUNT] = [
    MarketSession {
        session_index: 1,
        manifest_id: "wfm_hist_001_s01",
        market_session_id: "session-hist-001-s01",
        market_date_taipei: "2026-03-02",
        midnight_taipei_unix_micros: MIDNIGHT[0],
        manifest_hash_hex: "d557a68b64662d3b8fc4c192e9165b7f8d30b4d479bad15d60c12fd53f1936a0",
        interaction_fact_revision_ids: &[FACT_MOMENTUM_S1],
        interaction_fact_set_digest_hex: "01586dd0cb12777e93013798949c67602ce40c9a7f6351a5e7b913bf26dd9d80",
        outcome_evidence_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_MOMENTUM_S1, FACT_PRICE[0]],
        outcome_evidence_set_digest_hex: "be1d6b9601917d240c03a536e3cb26677dc2a6362a4e507ac7adcdc8bab76194",
        newly_visible_fact_revision_ids: &[FACT_MOMENTUM_S1, FACT_COUNTER_INVENTORY, FACT_PRICE[0]],
        sealed_close: twd(96, 0),
        close_price_fact_revision_id: FACT_PRICE[0],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 2,
        manifest_id: "wfm_hist_001_s02",
        market_session_id: "session-hist-001-s02",
        market_date_taipei: "2026-03-03",
        midnight_taipei_unix_micros: MIDNIGHT[1],
        manifest_hash_hex: "193845e4c18d5d052b8386917eeaa6261d47e72752dfacf0b6215ceae9703923",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_MOMENTUM_S1, FACT_PRICE[0]],
        interaction_fact_set_digest_hex: "be1d6b9601917d240c03a536e3cb26677dc2a6362a4e507ac7adcdc8bab76194",
        outcome_evidence_revision_ids: &[FACT_PRICE[1]],
        outcome_evidence_set_digest_hex: "783b469fd21be166f96e3df6ea0b5c657565194b7936588c313f23c8e0cf52ed",
        newly_visible_fact_revision_ids: &[FACT_PRICE[1]],
        sealed_close: twd(100, 0),
        close_price_fact_revision_id: FACT_PRICE[1],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 3,
        manifest_id: "wfm_hist_001_s03",
        market_session_id: "session-hist-001-s03",
        market_date_taipei: "2026-03-04",
        midnight_taipei_unix_micros: MIDNIGHT[2],
        manifest_hash_hex: "a7f70e3550debfa4be171803c9be1813ae1bc93e8e5329abd330d6d1d6aa2bf9",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_PRICE[0], FACT_PRICE[1]],
        interaction_fact_set_digest_hex: "5ff91fc7c73552f638d60f63f53f8797f096bf51f53d74eeb6664b8b56fa0ee2",
        outcome_evidence_revision_ids: &[FACT_PRICE[2]],
        outcome_evidence_set_digest_hex: "6165fafe6df310b6ac08462a142fa6cb0baa5245563adad9ab1c7e613fa1dcac",
        newly_visible_fact_revision_ids: &[FACT_PRICE[2]],
        sealed_close: twd(96, 400_000),
        close_price_fact_revision_id: FACT_PRICE[2],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 4,
        manifest_id: "wfm_hist_001_s04",
        market_session_id: "session-hist-001-s04",
        market_date_taipei: "2026-03-05",
        midnight_taipei_unix_micros: MIDNIGHT[3],
        manifest_hash_hex: "c18f31d97bc34a0eb01e1e9d96f6f08823711e77f24ef0143a4539242e48bc11",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_PRICE[1], FACT_PRICE[2]],
        interaction_fact_set_digest_hex: "0015a817e4cb5a958ef4504be637550da2ca8c5651aa83680eda932f8ddf6502",
        outcome_evidence_revision_ids: &[FACT_PRICE[3]],
        outcome_evidence_set_digest_hex: "9797deb5cd4a5e5bfbb189ab0bc53f0d2ccea281e009461ddef5dceb20473f34",
        newly_visible_fact_revision_ids: &[FACT_PRICE[3]],
        sealed_close: twd(93, 500_000),
        close_price_fact_revision_id: FACT_PRICE[3],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 5,
        manifest_id: "wfm_hist_001_s05",
        market_session_id: "session-hist-001-s05",
        market_date_taipei: "2026-03-06",
        midnight_taipei_unix_micros: MIDNIGHT[4],
        manifest_hash_hex: "bc3a3d14ca744907abf52a491fe394a8e5a3dcd4d39193d385b42afbe4ab95bc",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_PRICE[2], FACT_PRICE[3]],
        interaction_fact_set_digest_hex: "f968bcbc50f01229ca2d9113e670eca2bff86bac983f3a8687258c0fcc7e4ecb",
        outcome_evidence_revision_ids: &[FACT_PRICE[4]],
        outcome_evidence_set_digest_hex: "9e5c77f8178505f4056f432baddac97537ca0250eeb595efde82fe2c3a060adf",
        newly_visible_fact_revision_ids: &[FACT_PRICE[4]],
        sealed_close: twd(94, 100_000),
        close_price_fact_revision_id: FACT_PRICE[4],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 6,
        manifest_id: "wfm_hist_001_s06",
        market_session_id: "session-hist-001-s06",
        market_date_taipei: "2026-03-09",
        midnight_taipei_unix_micros: MIDNIGHT[5],
        manifest_hash_hex: "7c7b9b3d38f3b3aa21dac0010809898793db92b42db15a9434d3f1bd93135a7f",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_PRICE[3], FACT_PRICE[4]],
        interaction_fact_set_digest_hex: "118b4e7eeaecfa551163aed9af9d3cd940f9d7d96d75bc1b15496ed4ad522d53",
        outcome_evidence_revision_ids: &[FACT_PRICE[5]],
        outcome_evidence_set_digest_hex: "8494291ace06aef36b5b3ced30f67e87ed2089d10b3efc9a6b10fcc20b539b4c",
        newly_visible_fact_revision_ids: &[FACT_PRICE[5]],
        sealed_close: twd(92, 800_000),
        close_price_fact_revision_id: FACT_PRICE[5],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 7,
        manifest_id: "wfm_hist_001_s07",
        market_session_id: "session-hist-001-s07",
        market_date_taipei: "2026-03-10",
        midnight_taipei_unix_micros: MIDNIGHT[6],
        manifest_hash_hex: "7e516fe71886993bbc160e6995641908b487abfa3fb78f9af99bc1799082f3a8",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_PRICE[4], FACT_PRICE[5]],
        interaction_fact_set_digest_hex: "3d24a7ce3d8922a045e2af57b9b15229765f05206f97613c4d45765348cafba8",
        outcome_evidence_revision_ids: &[FACT_ISSUER_CORRECTION, FACT_PRICE[6]],
        outcome_evidence_set_digest_hex: "17bd3f879656231fefb15cbbf299f6649207a58a48cd55f26e418dbdd8f61eb4",
        newly_visible_fact_revision_ids: &[FACT_ISSUER_CORRECTION, FACT_PRICE[6]],
        sealed_close: twd(91, 600_000),
        close_price_fact_revision_id: FACT_PRICE[6],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 8,
        manifest_id: "wfm_hist_001_s08",
        market_session_id: "session-hist-001-s08",
        market_date_taipei: "2026-03-11",
        midnight_taipei_unix_micros: MIDNIGHT[7],
        manifest_hash_hex: "3313f876d840abf25ef888a22ab7d1a8e70ba200af9f55553fc78659d4e3c6a6",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_PRICE[5], FACT_ISSUER_CORRECTION, FACT_PRICE[6]],
        interaction_fact_set_digest_hex: "8715bf3f70a583526cd23f622d34d2b27952785d1b304a28700659f92f4a9066",
        outcome_evidence_revision_ids: &[FACT_PRICE[7]],
        outcome_evidence_set_digest_hex: "bb59054d24928c6ed0c40dc2c06abbb21ef47c93422215fb51473c6993a9eeaf",
        newly_visible_fact_revision_ids: &[FACT_PRICE[7]],
        sealed_close: twd(90, 900_000),
        close_price_fact_revision_id: FACT_PRICE[7],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 9,
        manifest_id: "wfm_hist_001_s09",
        market_session_id: "session-hist-001-s09",
        market_date_taipei: "2026-03-12",
        midnight_taipei_unix_micros: MIDNIGHT[8],
        manifest_hash_hex: "9fbb061facd6226be7175092a84f2d0364ed046ceb146a6e8cba51a8fda6df05",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_ISSUER_CORRECTION, FACT_PRICE[6], FACT_PRICE[7]],
        interaction_fact_set_digest_hex: "f06c0489fff61693bbf76580378730ae48811b7b1089b974e070de6cc2522bfe",
        outcome_evidence_revision_ids: &[FACT_PRICE[8]],
        outcome_evidence_set_digest_hex: "e4a67e1a2a687a997cccffe7d5e08ad85ee11be1a085412b0bcd22b03a1e7806",
        newly_visible_fact_revision_ids: &[FACT_PRICE[8]],
        sealed_close: twd(91, 300_000),
        close_price_fact_revision_id: FACT_PRICE[8],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 10,
        manifest_id: "wfm_hist_001_s10",
        market_session_id: "session-hist-001-s10",
        market_date_taipei: "2026-03-13",
        midnight_taipei_unix_micros: MIDNIGHT[9],
        manifest_hash_hex: "e15df39dbe507b96ee66698f84d82a8c2e54a3901d65598e7f140569f600b84a",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_ISSUER_CORRECTION, FACT_PRICE[7], FACT_PRICE[8]],
        interaction_fact_set_digest_hex: "43e03c6e67bf838301fe446b86cbfa98c3afbb980ad6d9a1c04a91257e91e38a",
        outcome_evidence_revision_ids: &[FACT_PRICE[9]],
        outcome_evidence_set_digest_hex: "aa2a715212b4a80d0843dfcf323ba064d99963aae6182f7be80e1970ea130c26",
        newly_visible_fact_revision_ids: &[FACT_PRICE[9]],
        sealed_close: twd(90, 200_000),
        close_price_fact_revision_id: FACT_PRICE[9],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 11,
        manifest_id: "wfm_hist_001_s11",
        market_session_id: "session-hist-001-s11",
        market_date_taipei: "2026-03-16",
        midnight_taipei_unix_micros: MIDNIGHT[10],
        manifest_hash_hex: "7b6e3a3e68e4fd2a8c6973cd23223d62f5718613a0b36feca9c72f8056fd8cc4",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_ISSUER_CORRECTION, FACT_PRICE[8], FACT_PRICE[9]],
        interaction_fact_set_digest_hex: "e885e2103263984b4438ce86b7f5bc8032866bbe9f3b653ba45c16ee72aac717",
        outcome_evidence_revision_ids: &[FACT_PRICE[10]],
        outcome_evidence_set_digest_hex: "f21aba0a5f68b8cee4427534cb05aa6351f0eee1d75dc07ed96f8b4fffd92fe6",
        newly_visible_fact_revision_ids: &[FACT_PRICE[10]],
        sealed_close: twd(89, 400_000),
        close_price_fact_revision_id: FACT_PRICE[10],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 12,
        manifest_id: "wfm_hist_001_s12",
        market_session_id: "session-hist-001-s12",
        market_date_taipei: "2026-03-17",
        midnight_taipei_unix_micros: MIDNIGHT[11],
        manifest_hash_hex: "a68ec706e9a9cd246a2314986159d949dd6693316b6c5b81ba40467e028d08e7",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_ISSUER_CORRECTION, FACT_PRICE[9], FACT_PRICE[10]],
        interaction_fact_set_digest_hex: "25f77fdea79a81512a1056180773a6d066c9b389890a3d62f79cb49bc4238040",
        outcome_evidence_revision_ids: &[FACT_PRICE[11]],
        outcome_evidence_set_digest_hex: "ee4d04c25fb0c2d4e38a991cb75689e857ed8f9d806e3a5c54fccfbc3b9d3900",
        newly_visible_fact_revision_ids: &[FACT_PRICE[11]],
        sealed_close: twd(88, 200_000),
        close_price_fact_revision_id: FACT_PRICE[11],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 13,
        manifest_id: "wfm_hist_001_s13",
        market_session_id: "session-hist-001-s13",
        market_date_taipei: "2026-03-18",
        midnight_taipei_unix_micros: MIDNIGHT[12],
        manifest_hash_hex: "fd0c27249b8336b09a0679d49cac6f1091be40dd7ec86a2f71c7573d139c16c0",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_ISSUER_CORRECTION, FACT_PRICE[10], FACT_PRICE[11]],
        interaction_fact_set_digest_hex: "f2e5ae74e226aa56d97d39a5f4107cbedb9c81befedabdd97033af7dd6cc6d9b",
        outcome_evidence_revision_ids: &[FACT_PRICE[12]],
        outcome_evidence_set_digest_hex: "7a5d475e2dc5064e49e9dc02117192628406f292710a9c8daae1308dd317e611",
        newly_visible_fact_revision_ids: &[FACT_PRICE[12]],
        sealed_close: twd(88, 600_000),
        close_price_fact_revision_id: FACT_PRICE[12],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 14,
        manifest_id: "wfm_hist_001_s14",
        market_session_id: "session-hist-001-s14",
        market_date_taipei: "2026-03-19",
        midnight_taipei_unix_micros: MIDNIGHT[13],
        manifest_hash_hex: "a0d2b8bd941663cc941a4f5f8a74008ad9b3a008f6b8e86eeae15d11118a5628",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_ISSUER_CORRECTION, FACT_PRICE[11], FACT_PRICE[12]],
        interaction_fact_set_digest_hex: "d2317da8247ecfe48224d94918741b80c5b5c2443ade1310f65055112f5964f1",
        outcome_evidence_revision_ids: &[FACT_PRICE[13]],
        outcome_evidence_set_digest_hex: "ff52bb856c9d969327acb45befbc64e9dd91851995b1ba3f8c20376be0d3cf64",
        newly_visible_fact_revision_ids: &[FACT_PRICE[13]],
        sealed_close: twd(89, 100_000),
        close_price_fact_revision_id: FACT_PRICE[13],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 15,
        manifest_id: "wfm_hist_001_s15",
        market_session_id: "session-hist-001-s15",
        market_date_taipei: "2026-03-20",
        midnight_taipei_unix_micros: MIDNIGHT[14],
        manifest_hash_hex: "dd5439d6961dea0865d0a0cb517e663cac6febebc8bab4447df2207c15d7927c",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_ISSUER_CORRECTION, FACT_PRICE[12], FACT_PRICE[13]],
        interaction_fact_set_digest_hex: "9f17aef33dc5af8761f788e40aedadf2039f30f84a75f50ecaa76b2c698b8273",
        outcome_evidence_revision_ids: &[FACT_PRICE[14]],
        outcome_evidence_set_digest_hex: "eb8f694ca96470f2c975be3640006485a029ececbf3dd5116401d9176010490a",
        newly_visible_fact_revision_ids: &[FACT_PRICE[14]],
        sealed_close: twd(88, 900_000),
        close_price_fact_revision_id: FACT_PRICE[14],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 16,
        manifest_id: "wfm_hist_001_s16",
        market_session_id: "session-hist-001-s16",
        market_date_taipei: "2026-03-23",
        midnight_taipei_unix_micros: MIDNIGHT[15],
        manifest_hash_hex: "99d4e679553464e393396654c12759e6ae799fc635bb521d7e241849c8a21e0b",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_ISSUER_CORRECTION, FACT_PRICE[13], FACT_PRICE[14]],
        interaction_fact_set_digest_hex: "0dbd0f562252daac0694da293501faf1b9f49a415dc70224a5023a836f51e05b",
        outcome_evidence_revision_ids: &[FACT_PRICE[15]],
        outcome_evidence_set_digest_hex: "789b8eb27c96f4e138f003cd49e418831ff4deaa115b0f35ad03f8342e25284b",
        newly_visible_fact_revision_ids: &[FACT_PRICE[15]],
        sealed_close: twd(88, 300_000),
        close_price_fact_revision_id: FACT_PRICE[15],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 17,
        manifest_id: "wfm_hist_001_s17",
        market_session_id: "session-hist-001-s17",
        market_date_taipei: "2026-03-24",
        midnight_taipei_unix_micros: MIDNIGHT[16],
        manifest_hash_hex: "f5e39bfd8890846921383ae817003c75d9e35c9da7ec153a134fd767957f2dd4",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_ISSUER_CORRECTION, FACT_PRICE[14], FACT_PRICE[15]],
        interaction_fact_set_digest_hex: "e492d9175ba1e2d378a6d647ecccaf8234b52ba5fae8fea456315db369ffcb2a",
        outcome_evidence_revision_ids: &[FACT_PRICE[16]],
        outcome_evidence_set_digest_hex: "6116c00e5acb7667870ddb577721059358f40ece2aee6f75bf5ad112ee49e8c7",
        newly_visible_fact_revision_ids: &[FACT_PRICE[16]],
        sealed_close: twd(87, 600_000),
        close_price_fact_revision_id: FACT_PRICE[16],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 18,
        manifest_id: "wfm_hist_001_s18",
        market_session_id: "session-hist-001-s18",
        market_date_taipei: "2026-03-25",
        midnight_taipei_unix_micros: MIDNIGHT[17],
        manifest_hash_hex: "131e9541808c8bf0fd5aa310cdce8a1a24581340256891032a320a04f0acf7bc",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_ISSUER_CORRECTION, FACT_PRICE[15], FACT_PRICE[16]],
        interaction_fact_set_digest_hex: "3947433d7523eec733ed5144e917f8c89b16b1f15c14a2d2353cf3e42b42fada",
        outcome_evidence_revision_ids: &[FACT_PRICE[17]],
        outcome_evidence_set_digest_hex: "65a892e30cc06b3301c8698bb41d1e41d5624198a2b408d4fa9d8b70070bb549",
        newly_visible_fact_revision_ids: &[FACT_PRICE[17]],
        sealed_close: twd(86, 900_000),
        close_price_fact_revision_id: FACT_PRICE[17],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 19,
        manifest_id: "wfm_hist_001_s19",
        market_session_id: "session-hist-001-s19",
        market_date_taipei: "2026-03-26",
        midnight_taipei_unix_micros: MIDNIGHT[18],
        manifest_hash_hex: "5561aa6c2117e732d08b1add5723536d3ce4459cf3e96b6ba739f89993582701",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_ISSUER_CORRECTION, FACT_PRICE[16], FACT_PRICE[17]],
        interaction_fact_set_digest_hex: "4e83c568d93ac7224536b654b0a1219c43e24d9452fc8713799b2ab7fa519214",
        outcome_evidence_revision_ids: &[FACT_PRICE[18]],
        outcome_evidence_set_digest_hex: "2b5385df584ebb52bf9e0b98e823f98cdd97e1643a5bc6fd7465a302d88bac40",
        newly_visible_fact_revision_ids: &[FACT_PRICE[18]],
        sealed_close: twd(86, 100_000),
        close_price_fact_revision_id: FACT_PRICE[18],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 20,
        manifest_id: "wfm_hist_001_s20",
        market_session_id: "session-hist-001-s20",
        market_date_taipei: "2026-03-27",
        midnight_taipei_unix_micros: MIDNIGHT[19],
        manifest_hash_hex: "83477b2e68ee0a198d7ef331913a5e89a92ed1dad8d7f516e5339c814270b392",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_ISSUER_CORRECTION, FACT_PRICE[17], FACT_PRICE[18]],
        interaction_fact_set_digest_hex: "13a76706b437a415a316cebfec400979415e455ac31c2c92250f4cfa289d0bcc",
        outcome_evidence_revision_ids: &[FACT_PRICE[19]],
        outcome_evidence_set_digest_hex: "83698b4ba4481048f02a322639085d9e1a39e73e33f8dd8f0dc9aa13afefcc79",
        newly_visible_fact_revision_ids: &[FACT_PRICE[19]],
        sealed_close: twd(85, 700_000),
        close_price_fact_revision_id: FACT_PRICE[19],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 21,
        manifest_id: "wfm_hist_001_s21",
        market_session_id: "session-hist-001-s21",
        market_date_taipei: "2026-03-30",
        midnight_taipei_unix_micros: MIDNIGHT[20],
        manifest_hash_hex: "9f94089101a92910a6069e37b7cd5d856e957764671d303fa22a573bc5c0e122",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_ISSUER_CORRECTION, FACT_PRICE[18], FACT_PRICE[19]],
        interaction_fact_set_digest_hex: "ce618a5d5601693136e8fd2941eb70d0b4dadbdf18742fcc8237bece7ca38b3a",
        outcome_evidence_revision_ids: &[FACT_PRICE[20]],
        outcome_evidence_set_digest_hex: "ead6e266793b5abef0191dc803ad135a89bea105152835eeaa72e78d524230dd",
        newly_visible_fact_revision_ids: &[FACT_PRICE[20]],
        sealed_close: twd(86, 200_000),
        close_price_fact_revision_id: FACT_PRICE[20],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 22,
        manifest_id: "wfm_hist_001_s22",
        market_session_id: "session-hist-001-s22",
        market_date_taipei: "2026-03-31",
        midnight_taipei_unix_micros: MIDNIGHT[21],
        manifest_hash_hex: "912591763cb09445d3a4efc4a4487662e2c6b5587084e2da7954b6a8ef79861d",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_ISSUER_CORRECTION, FACT_PRICE[19], FACT_PRICE[20]],
        interaction_fact_set_digest_hex: "3a115159c800dc38f315edbb9e662218cbb29832ea3e4821fc9c249a32d321d6",
        outcome_evidence_revision_ids: &[FACT_PRICE[21]],
        outcome_evidence_set_digest_hex: "b0ab7ee6296fcf2da79dfcff5bb268154d27bb285c7bb4adcab8ce522d0c4cfd",
        newly_visible_fact_revision_ids: &[FACT_PRICE[21]],
        sealed_close: twd(86, 800_000),
        close_price_fact_revision_id: FACT_PRICE[21],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 23,
        manifest_id: "wfm_hist_001_s23",
        market_session_id: "session-hist-001-s23",
        market_date_taipei: "2026-04-01",
        midnight_taipei_unix_micros: MIDNIGHT[22],
        manifest_hash_hex: "01966479072590eb304171aa91710ab2e9dc2cefcbe17ca912fa7d881ef3590e",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_ISSUER_CORRECTION, FACT_PRICE[20], FACT_PRICE[21]],
        interaction_fact_set_digest_hex: "24147dd800a3c89171b44789e6e30a97d6185e2fb1dbdc6d5286befb29b2314f",
        outcome_evidence_revision_ids: &[FACT_PRICE[22]],
        outcome_evidence_set_digest_hex: "66be6ed917be632ed5a75f822ae0643dd1dc6eb2d0dbb8cf30d4400f552b6ff8",
        newly_visible_fact_revision_ids: &[FACT_PRICE[22]],
        sealed_close: twd(87, 100_000),
        close_price_fact_revision_id: FACT_PRICE[22],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 24,
        manifest_id: "wfm_hist_001_s24",
        market_session_id: "session-hist-001-s24",
        market_date_taipei: "2026-04-02",
        midnight_taipei_unix_micros: MIDNIGHT[23],
        manifest_hash_hex: "722f80df7798d0f832e756f18ec5f3378135121896200223e6acea803c6d0e87",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_ISSUER_CORRECTION, FACT_PRICE[21], FACT_PRICE[22]],
        interaction_fact_set_digest_hex: "4cf2e29eab7708033969573408f4645de037d61d07621954e42efbf25093e228",
        outcome_evidence_revision_ids: &[FACT_PRICE[23]],
        outcome_evidence_set_digest_hex: "09457b1470fa8de9872aba6cc9ffdcb9cee943040f725770e4e25eaff05b26e5",
        newly_visible_fact_revision_ids: &[FACT_PRICE[23]],
        sealed_close: twd(87, 500_000),
        close_price_fact_revision_id: FACT_PRICE[23],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 25,
        manifest_id: "wfm_hist_001_s25",
        market_session_id: "session-hist-001-s25",
        market_date_taipei: "2026-04-07",
        midnight_taipei_unix_micros: MIDNIGHT[24],
        manifest_hash_hex: "c0747cf8b1a584044529fb75db9d898eb4707eab09f7d4458c2d10cb9b5d1116",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_ISSUER_CORRECTION, FACT_PRICE[22], FACT_PRICE[23]],
        interaction_fact_set_digest_hex: "055b9f3fc268f1e914fffd4364530a09b39637f3c6cb5798ce69259fcde5713f",
        outcome_evidence_revision_ids: &[FACT_PRICE[24]],
        outcome_evidence_set_digest_hex: "f1c05dda1858f49ef79562c60bb2f7f18df10853993342055fd144ad7815c98e",
        newly_visible_fact_revision_ids: &[FACT_PRICE[24]],
        sealed_close: twd(86, 800_000),
        close_price_fact_revision_id: FACT_PRICE[24],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 26,
        manifest_id: "wfm_hist_001_s26",
        market_session_id: "session-hist-001-s26",
        market_date_taipei: "2026-04-08",
        midnight_taipei_unix_micros: MIDNIGHT[25],
        manifest_hash_hex: "bf795be4f3120fb90bf72eda5e1e8f210ad5f2ea7914a10ea17ce7e256913246",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_ISSUER_CORRECTION, FACT_PRICE[23], FACT_PRICE[24]],
        interaction_fact_set_digest_hex: "404e70bf3b0bc4a65dd66053a926dd39ad08a6cf37857f53bf16fb465f469074",
        outcome_evidence_revision_ids: &[FACT_PRICE[25]],
        outcome_evidence_set_digest_hex: "922741726f23b39761338da5721dbfa9fd7bc8a251293a592cb83fdc692a0f33",
        newly_visible_fact_revision_ids: &[FACT_PRICE[25]],
        sealed_close: twd(86, 400_000),
        close_price_fact_revision_id: FACT_PRICE[25],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 27,
        manifest_id: "wfm_hist_001_s27",
        market_session_id: "session-hist-001-s27",
        market_date_taipei: "2026-04-09",
        midnight_taipei_unix_micros: MIDNIGHT[26],
        manifest_hash_hex: "721a7f9690f7cd4186355db40146c47fc714f068096c8978ee4a3c41ab03f32a",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_ISSUER_CORRECTION, FACT_PRICE[24], FACT_PRICE[25]],
        interaction_fact_set_digest_hex: "a70506ef8c6ce23256ef27fb5847433495d376a02bc546734dfe5933b1bc05a5",
        outcome_evidence_revision_ids: &[FACT_PRICE[26]],
        outcome_evidence_set_digest_hex: "45b316188228d17c4b0e451afad4b45f7614b53198613d1aa9f31dc0db4bc546",
        newly_visible_fact_revision_ids: &[FACT_PRICE[26]],
        sealed_close: twd(86, 900_000),
        close_price_fact_revision_id: FACT_PRICE[26],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 28,
        manifest_id: "wfm_hist_001_s28",
        market_session_id: "session-hist-001-s28",
        market_date_taipei: "2026-04-10",
        midnight_taipei_unix_micros: MIDNIGHT[27],
        manifest_hash_hex: "c7305756b1d8b13dabfefcc2faaa35ea5675c558925e90c91441f8322fb5b422",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_ISSUER_CORRECTION, FACT_PRICE[25], FACT_PRICE[26]],
        interaction_fact_set_digest_hex: "37adc77c147669a2482d67a457adc3effcad7f7114ba6f0a29922285cfbe4edf",
        outcome_evidence_revision_ids: &[FACT_PRICE[27]],
        outcome_evidence_set_digest_hex: "191e79b2d0ef72af2ca6bc83b5665c12da9d630b30d9df4b95f159690dc56505",
        newly_visible_fact_revision_ids: &[FACT_PRICE[27]],
        sealed_close: twd(87, 400_000),
        close_price_fact_revision_id: FACT_PRICE[27],
        finality_accepted: true,
    },
    MarketSession {
        session_index: 29,
        manifest_id: "wfm_hist_001_s29",
        market_session_id: "session-hist-001-s29",
        market_date_taipei: "2026-04-13",
        midnight_taipei_unix_micros: MIDNIGHT[28],
        manifest_hash_hex: "c18790acc91724a77dfc028c03af1ffee0693afa6dc77ffd0864bb1e4ba8a24e",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_ISSUER_CORRECTION, FACT_PRICE[26], FACT_PRICE[27]],
        interaction_fact_set_digest_hex: "eace719418a29a1f669185c7a70e16980ed9a429bf9f5e7ec28a818fa9503c4c",
        outcome_evidence_revision_ids: &[FACT_PRICE[28]],
        outcome_evidence_set_digest_hex: "a9e5dba0540ad75fdd0887499b3a6fd0ef04062806d6d05a70cdc945ace334e3",
        newly_visible_fact_revision_ids: &[FACT_PRICE[28]],
        sealed_close: twd(87, 200_000),
        close_price_fact_revision_id: FACT_PRICE[28],
        finality_accepted: true,
    },
    // "Today". The price revision exists, but its
    // `marketSessionFinalityState` is `pending`, so it may not be used as a
    // settled mark source; the slice marks against the previous accepted
    // close and labels the number as of that session. This session publishes
    // no chapter and discloses no same-day action.
    MarketSession {
        session_index: 30,
        manifest_id: "wfm_hist_001_s30",
        market_session_id: "session-hist-001-s30",
        market_date_taipei: "2026-04-14",
        midnight_taipei_unix_micros: MIDNIGHT[29],
        manifest_hash_hex: "36ac40cc12e835aa87e1c8701d51b0ac64378dfb2bce2dd4d6ba51284d05e1b8",
        interaction_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_ISSUER_CORRECTION, FACT_PRICE[28], FACT_PRICE[29]],
        interaction_fact_set_digest_hex: "d8aa2d97fc326882818bf201df13d6166f388cce03d6687076ab6f752f3513bd",
        outcome_evidence_revision_ids: &[],
        outcome_evidence_set_digest_hex: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        newly_visible_fact_revision_ids: &[FACT_PRICE[29]],
        sealed_close: twd(87, 200_000),
        close_price_fact_revision_id: FACT_PRICE[29],
        finality_accepted: false,
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

/// Whether a later sealed revision, already available at `as_of_unix_micros`,
/// supersedes `fact_revision_id` -- i.e. whether the fixture itself has
/// published that the fact was wrong. Unknown ids answer `false`: a fact this
/// repository has not mirrored is never treated as corrected.
#[must_use]
pub fn fact_was_corrected_by(fact_revision_id: &str, as_of_unix_micros: i64) -> bool {
    FACTS.iter().any(|fact| {
        fact.supersedes_fact_revision_id == Some(fact_revision_id)
            && fact.available_at_unix_micros <= as_of_unix_micros
    })
}

// -- Session table -------------------------------------------------------------

/// One synthetic historical market session, mirroring one upstream manifest.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MarketSession {
    /// 1-based, matching the S1..S30 labels used across the V5 docs.
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
    /// This session's own sealed close, from `fact-hist-001-sNN-price`.
    pub sealed_close: Fixed,
    pub close_price_fact_revision_id: &'static str,
    /// Mirrors `price.payload.marketSessionFinalityState == "accepted"`.
    /// `false` only for S30, whose price revision is still `pending`.
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

    /// 14:30 Taipei -- when finality is accepted for S1..S29.
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


/// The last session whose price may be presented as settled -- the source of
/// the "截至前一交易日收盤" label the close-up carries.
pub const LAST_FINAL_SESSION_INDEX: usize = 29;

/// The last session with accepted finality.
#[must_use]
pub fn last_final_session() -> &'static MarketSession {
    &SESSIONS[LAST_FINAL_SESSION_INDEX - 1]
}

#[cfg(test)]
mod tests {
    use super::{
        FACT_COUNT, FACT_ISSUER_CORRECTION, FACT_MOMENTUM_S1, FACTS, LAST_FINAL_SESSION_INDEX,
        SESSIONS, SESSION_COUNT, fact_available_at, fact_was_corrected_by, last_final_session,
    };
    use panshi_decision_kernel::Fixed;
    use serde_json::Value;

    const MANIFESTS_JSON: &str = include_str!(
        "../../../../contracts/world-fact-manifest/historical-v1/fixtures/synthetic-historical-001.json"
    );
    const FACT_REVISIONS_JSON: &str = include_str!(
        "../../../../contracts/world-fact-manifest/historical-v1/fixtures/synthetic-historical-001-fact-revisions.json"
    );

    /// Days since 1970-01-01 for a proleptic Gregorian civil date (Howard
    /// Hinnant's algorithm, integer arithmetic only).
    fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
        let year = if month <= 2 { year - 1 } else { year };
        let era = if year >= 0 { year } else { year - 399 } / 400;
        let year_of_era = year - era * 400;
        let month_index = (month + 9) % 12;
        let day_of_year = (153 * month_index + 2) / 5 + day - 1;
        let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
        era * 146_097 + day_of_era - 719_468
    }

    /// Parses exactly the `YYYY-MM-DDTHH:MM:SS+08:00` shape the fixture uses.
    /// Anything else fails the test rather than being guessed at.
    fn taipei_unix_micros(text: &str) -> i64 {
        let bytes = text.as_bytes();
        assert!(
            bytes.len() == 25 && text.ends_with("+08:00") && bytes[10] == b'T',
            "unexpected timestamp shape: {text}"
        );
        let field = |from: usize, to: usize| -> i64 {
            text[from..to]
                .parse::<i64>()
                .unwrap_or_else(|_| panic!("non-numeric timestamp field in {text}"))
        };
        let days = days_from_civil(field(0, 4), field(5, 7), field(8, 10));
        let seconds = days * 86_400 + field(11, 13) * 3_600 + field(14, 16) * 60 + field(17, 19)
            - 8 * 3_600;
        seconds * 1_000_000
    }

    fn string_list(value: &Value) -> Vec<String> {
        value
            .as_array()
            .expect("an id list is an array")
            .iter()
            .map(|id| id.as_str().expect("an id is a string").to_owned())
            .collect()
    }

    fn text<'a>(value: &'a Value, key: &str) -> &'a str {
        value[key]
            .as_str()
            .unwrap_or_else(|| panic!("{key} is not a string"))
    }

    /// The anti-drift guard: every mirrored field of the session table and
    /// the fact table is compared against the sealed JSON fixture itself,
    /// read at compile time. A hand edit on either side fails here.
    #[test]
    #[allow(clippy::too_many_lines)]
    fn the_table_mirrors_the_sealed_json_fixture_field_for_field() {
        let manifests: Value = serde_json::from_str(MANIFESTS_JSON).expect("manifest fixture parses");
        let facts: Value =
            serde_json::from_str(FACT_REVISIONS_JSON).expect("fact revision fixture parses");
        let manifests = manifests.as_array().expect("manifest fixture is an array");
        let facts = facts.as_array().expect("fact revision fixture is an array");

        assert_eq!(manifests.len(), SESSION_COUNT);
        assert_eq!(facts.len(), FACT_COUNT);

        for (fact, mirrored) in facts.iter().zip(FACTS.iter()) {
            let id = text(fact, "factRevisionId");
            assert_eq!(id, mirrored.fact_revision_id);
            assert_eq!(text(fact, "manifestId"), mirrored.manifest_id, "{id}: manifestId");
            let available = taipei_unix_micros(text(fact, "worldPublishedAt"))
                .max(taipei_unix_micros(text(fact, "platformReceivedAt")));
            assert_eq!(available, mirrored.available_at_unix_micros, "{id}: available_at");
            assert_eq!(
                fact["supersedesFactRevisionId"].as_str(),
                mirrored.supersedes_fact_revision_id,
                "{id}: supersedesFactRevisionId"
            );
            assert_eq!(text(fact, "truthClass"), "fictional_setting", "{id}: truthClass");
            assert_eq!(text(fact, "provenanceClass"), "synthetic_fixture", "{id}: provenance");
        }

        for (manifest, session) in manifests.iter().zip(SESSIONS.iter()) {
            let manifest_id = text(manifest, "manifestId");
            assert_eq!(manifest_id, session.manifest_id);
            assert_eq!(text(manifest, "marketSessionId"), session.market_session_id);
            assert_eq!(text(manifest, "marketDateTaipei"), session.market_date_taipei);
            assert_eq!(
                taipei_unix_micros(&format!("{}T00:00:00+08:00", session.market_date_taipei)),
                session.midnight_taipei_unix_micros,
                "{manifest_id}: midnight"
            );
            assert_eq!(
                text(manifest, "manifestHash"),
                format!("sha256:{}", session.manifest_hash_hex),
                "{manifest_id}: manifestHash"
            );
            assert_eq!(
                text(manifest, "interactionFactSetDigest"),
                format!("sha256:{}", session.interaction_fact_set_digest_hex),
                "{manifest_id}: interactionFactSetDigest"
            );
            assert_eq!(
                text(manifest, "outcomeEvidenceSetDigest"),
                format!("sha256:{}", session.outcome_evidence_set_digest_hex),
                "{manifest_id}: outcomeEvidenceSetDigest"
            );
            assert_eq!(
                taipei_unix_micros(text(manifest, "interactionCutoffAt")),
                session.interaction_cutoff_unix_micros(),
                "{manifest_id}: interactionCutoffAt"
            );
            assert_eq!(
                taipei_unix_micros(text(manifest, "evidenceCutoffAt")),
                session.evidence_cutoff_unix_micros(),
                "{manifest_id}: evidenceCutoffAt"
            );
            assert_eq!(
                string_list(&manifest["interactionFactRevisionIds"]),
                session.interaction_fact_revision_ids,
                "{manifest_id}: interaction allowlist"
            );
            assert_eq!(
                string_list(&manifest["outcomeEvidenceRevisionIds"]),
                session.outcome_evidence_revision_ids,
                "{manifest_id}: outcome allowlist"
            );
            let sealed_here: Vec<&str> = facts
                .iter()
                .filter(|fact| text(fact, "manifestId") == manifest_id)
                .map(|fact| text(fact, "factRevisionId"))
                .collect();
            assert_eq!(
                sealed_here, session.newly_visible_fact_revision_ids,
                "{manifest_id}: newly visible facts"
            );
            let close = facts
                .iter()
                .find(|fact| {
                    text(fact, "manifestId") == manifest_id
                        && fact["payload"]["kind"].as_str() == Some("sealed_close_price")
                })
                .unwrap_or_else(|| panic!("{manifest_id} seals no close"));
            assert_eq!(
                text(close, "factRevisionId"),
                session.close_price_fact_revision_id,
                "{manifest_id}: close revision"
            );
            // Fixture unit: minor units scaled by 1,000,000. `Fixed` raw is
            // six decimals of one TWD, and one TWD is 100 minor units.
            assert_eq!(
                close["payload"]["sealedClosePriceMinorUnitsFixed6"].as_i64(),
                Some(session.sealed_close.raw() * 100),
                "{manifest_id}: sealed close"
            );
            assert_eq!(
                close["payload"]["marketSessionFinalityState"].as_str(),
                Some(if session.finality_accepted { "accepted" } else { "pending" }),
                "{manifest_id}: finality"
            );
        }
    }

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
        assert_eq!(accepted, (1..=29).collect::<Vec<usize>>());
        assert_eq!(accepted.len(), LAST_FINAL_SESSION_INDEX);
        assert_eq!(last_final_session().market_date_taipei, "2026-04-13");
        // Today has no outcome evidence at all.
        assert!(SESSIONS[SESSION_COUNT - 1].outcome_evidence_revision_ids.is_empty());
    }

    /// The six original beats stay on their original dates and closes; the
    /// thirty-day extension only fills in the trading days between them and
    /// continues after them.
    #[test]
    fn the_original_beats_keep_their_dates_and_closes() {
        for (date, units, micros) in [
            ("2026-03-02", 96, 0),
            ("2026-03-03", 100, 0),
            ("2026-03-05", 93, 500_000),
            ("2026-03-10", 91, 600_000),
            ("2026-03-17", 88, 200_000),
        ] {
            let session = SESSIONS
                .iter()
                .find(|session| session.market_date_taipei == date)
                .unwrap_or_else(|| panic!("{date} is no longer a session"));
            assert_eq!(session.sealed_close.raw(), units * Fixed::SCALE + micros, "{date}");
        }
        assert!(SESSIONS.iter().any(|session| session.market_date_taipei == "2026-03-18"));
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
    /// session's cognition and appears only as outcome evidence -- the S7
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
        assert!(!SESSIONS[6].interaction_fact_revision_ids.contains(&FACT_ISSUER_CORRECTION));
        assert!(SESSIONS[7].interaction_fact_revision_ids.contains(&FACT_ISSUER_CORRECTION));
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
        // Each revision becomes visible exactly once.
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

    /// The only published correction is the issuer notice, and it corrects
    /// the early-move signal -- which is what later makes "blaming the
    /// signal he relied on" a legitimate complaint rather than a shifted one.
    #[test]
    fn the_issuer_correction_is_the_only_supersession() {
        let superseding: Vec<(&str, &str)> = FACTS
            .iter()
            .filter_map(|fact| {
                fact.supersedes_fact_revision_id
                    .map(|corrected| (fact.fact_revision_id, corrected))
            })
            .collect();
        assert_eq!(superseding, vec![(FACT_ISSUER_CORRECTION, FACT_MOMENTUM_S1)]);
        let correction_at = fact_available_at(FACT_ISSUER_CORRECTION);
        assert!(!fact_was_corrected_by(FACT_MOMENTUM_S1, correction_at - 1));
        assert!(fact_was_corrected_by(FACT_MOMENTUM_S1, correction_at));
        assert!(!fact_was_corrected_by("acq-hist-001-xiaoyu", i64::MAX));
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
