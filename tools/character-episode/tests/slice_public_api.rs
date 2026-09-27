//! Integration tests for the one-character slice's public read-side
//! projection (`panshi_character_episode::public_api`).
//!
//! The first test is the seam between two independently authored halves of
//! this slice: the sealed historical fact fixture that
//! `contracts/world-fact-manifest/historical-v1/` owns, and the frozen
//! session table in `tools/character-episode/src/slice/sessions.rs` that
//! mirrors it. If either side is edited alone, the mirror stops being a
//! mirror and this test says so. The remaining tests are the public
//! projection's own product invariants: determinism, `truth_class`
//! integrity, the same-day disclosure fence, the as-of fence, the typed
//! evidence card surviving a failed narrative, held chapters leaking
//! nothing, one hash per sealed sentence on every surface, and provenance
//! on every deep-archive item.

use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Write as _,
    fs,
    path::PathBuf,
};

use panshi_character_episode::{
    public_api::{ProjectionFaults, public_api_documents, public_api_documents_with},
    slice::{
        CHAPTER_COUNT, one_character_slice,
        seed,
        sessions::{SESSIONS, SESSION_COUNT},
    },
};
use panshi_character_domain::utterance::UtteranceArtifact;
use panshi_protocol::{canonical_bytes, character, decode_canonical};
use serde_json::Value;

/// The last accepted close. Every currently-visible paper figure in the
/// slice is dated here, never to the in-session day.
const PREVIOUS_CLOSE: &str = "2026-04-13T13:30:00+08:00";

/// The close of the reduction (S12), the last settled change to the lot book.
const LAST_POSITION_CHANGE: &str = "2026-03-17T13:30:00+08:00";

/// Today, whose finality is still pending. No paper figure may be dated to
/// it.
const IN_SESSION_DATE: &str = "2026-04-14";

fn repository_path(relative: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
}

fn read_json(relative: &str) -> Value {
    let path = repository_path(relative);
    let text = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("parse {}: {error}", path.display()))
}

fn documents() -> Vec<(String, Value)> {
    documents_with(&ProjectionFaults::default())
}

fn documents_with(faults: &ProjectionFaults) -> Vec<(String, Value)> {
    public_api_documents_with(&one_character_slice(), faults)
        .into_iter()
        .map(|(path, text)| {
            let value = serde_json::from_str(&text)
                .unwrap_or_else(|error| panic!("{path} is not valid JSON: {error}"));
            (path, value)
        })
        .collect()
}

fn document_named(documents: &[(String, Value)], suffix: &str) -> Value {
    documents
        .iter()
        .find(|(path, _)| path.ends_with(suffix))
        .map_or_else(
            || panic!("no document ending in {suffix}"),
            |(_, value)| value.clone(),
        )
}

fn as_str(value: &Value, key: &str) -> String {
    value[key]
        .as_str()
        .unwrap_or_else(|| panic!("{key} is not a string"))
        .to_owned()
}

/// Collects every string value stored under any of `keys`, anywhere in the
/// document tree.
fn collect_strings(value: &Value, keys: &[&str], found: &mut Vec<(String, String)>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                if keys.contains(&key.as_str())
                    && let Some(text) = child.as_str()
                {
                    found.push((key.clone(), text.to_owned()));
                }
                collect_strings(child, keys, found);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_strings(item, keys, found);
            }
        }
        _ => {}
    }
}

/// The wave-1 seam check: the frozen session table in `slice/sessions.rs`
/// must be a field-for-field mirror of the sealed historical fixture the
/// contract directory owns. Manifest ids, market dates, cutoffs, allowlists,
/// set digests, sealed closes and finality state are all compared.
#[test]
#[allow(clippy::too_many_lines)]
fn slice_session_constants_match_the_historical_manifest_fixture() {
    let manifests = read_json(
        "contracts/world-fact-manifest/historical-v1/fixtures/synthetic-historical-001.json",
    );
    let fact_revisions = read_json(
        "contracts/world-fact-manifest/historical-v1/fixtures/synthetic-historical-001-fact-revisions.json",
    );
    let manifests = manifests.as_array().expect("manifest fixture is an array");
    let fact_revisions = fact_revisions
        .as_array()
        .expect("fact revision fixture is an array");

    assert_eq!(
        manifests.len(),
        SESSION_COUNT,
        "the fixture and the session table must describe the same number of sessions"
    );

    for (manifest, session) in manifests.iter().zip(SESSIONS.iter()) {
        let manifest_id = as_str(manifest, "manifestId");
        assert_eq!(manifest_id, session.manifest_id);
        assert_eq!(
            as_str(manifest, "marketSessionId"),
            session.market_session_id,
            "{manifest_id}: market session id"
        );
        assert_eq!(
            as_str(manifest, "marketDateTaipei"),
            session.market_date_taipei,
            "{manifest_id}: market date"
        );
        // The mirror stores upstream digests without their `sha256:` prefix
        // and never recomputes them.
        assert_eq!(
            as_str(manifest, "manifestHash"),
            format!("sha256:{}", session.manifest_hash_hex),
            "{manifest_id}: manifest hash"
        );
        assert_eq!(
            as_str(manifest, "interactionFactSetDigest"),
            format!("sha256:{}", session.interaction_fact_set_digest_hex),
            "{manifest_id}: interaction fact set digest"
        );
        assert_eq!(
            as_str(manifest, "outcomeEvidenceSetDigest"),
            format!("sha256:{}", session.outcome_evidence_set_digest_hex),
            "{manifest_id}: outcome evidence set digest"
        );
        assert_eq!(
            as_str(manifest, "interactionCutoffAt"),
            format!("{}T09:00:00+08:00", session.market_date_taipei),
            "{manifest_id}: interaction cutoff"
        );
        assert_eq!(
            as_str(manifest, "evidenceCutoffAt"),
            format!("{}T13:30:00+08:00", session.market_date_taipei),
            "{manifest_id}: evidence cutoff"
        );

        let fixture_interaction: Vec<String> = manifest["interactionFactRevisionIds"]
            .as_array()
            .expect("interaction allowlist is an array")
            .iter()
            .map(|value| value.as_str().expect("fact id is a string").to_owned())
            .collect();
        assert_eq!(
            fixture_interaction, session.interaction_fact_revision_ids,
            "{manifest_id}: interaction allowlist"
        );
        let fixture_outcome: Vec<String> = manifest["outcomeEvidenceRevisionIds"]
            .as_array()
            .expect("outcome allowlist is an array")
            .iter()
            .map(|value| value.as_str().expect("fact id is a string").to_owned())
            .collect();
        assert_eq!(
            fixture_outcome, session.outcome_evidence_revision_ids,
            "{manifest_id}: outcome allowlist"
        );

        // The sealed close, in the fixture's own unit: currency minor units
        // scaled by 1,000,000. `Fixed` raw is six decimals of one TWD, and
        // one TWD is 100 minor units, so the two differ by exactly 100.
        let price = fact_revisions
            .iter()
            .find(|revision| {
                revision["factRevisionId"].as_str() == Some(session.close_price_fact_revision_id)
            })
            .unwrap_or_else(|| {
                panic!(
                    "{manifest_id}: no fact revision {}",
                    session.close_price_fact_revision_id
                )
            });
        assert_eq!(
            as_str(price, "manifestId"),
            session.manifest_id,
            "{manifest_id}: the close price belongs to this manifest"
        );
        assert_eq!(
            price["payload"]["sealedClosePriceMinorUnitsFixed6"]
                .as_i64()
                .expect("sealed close is an integer"),
            session.sealed_close.raw() * 100,
            "{manifest_id}: sealed close"
        );
        assert_eq!(
            price["payload"]["marketSessionFinalityState"]
                .as_str()
                .expect("finality state is a string"),
            if session.finality_accepted {
                "accepted"
            } else {
                "pending"
            },
            "{manifest_id}: finality state"
        );
        // A synthesized close may never be labelled a real fact.
        assert_eq!(as_str(price, "truthClass"), "fictional_setting");
        assert_eq!(as_str(price, "provenanceClass"), "synthetic_fixture");
    }
}

#[test]
fn public_api_documents_are_deterministic() {
    let first = public_api_documents(&one_character_slice());
    let second = public_api_documents(&one_character_slice());
    // Ten public-v2 documents plus the route index.
    assert_eq!(first.len(), 11);
    assert_eq!(first, second, "two folds of the same log must be identical");
    // Injecting no fault is exactly the default projection.
    assert_eq!(
        first,
        public_api_documents_with(&one_character_slice(), &ProjectionFaults::default())
    );
}

/// This slice's market facts are a repo-local synthetic fixture. Labelling
/// any of them a real fact would be a lie, so the string may not appear
/// anywhere in any response -- not in `truthClasses`, and not in prose.
#[test]
fn no_document_contains_real_fact() {
    for (path, text) in public_api_documents(&one_character_slice()) {
        assert!(
            !text.contains("real_fact"),
            "{path} claims a real fact in a synthetic fixture"
        );
    }
    for (_, document) in documents() {
        if let Some(classes) = document["truthClasses"].as_array() {
            for class in classes {
                let class = class.as_str().expect("truth class is a string");
                assert!(
                    ["fictional_setting", "symbolic_interpretation", "simulated_narrative"]
                        .contains(&class),
                    "unexpected truth class {class}"
                );
            }
        }
    }
}

/// Today's finality is still pending, so the same-day disclosure key is not
/// serialized at all -- not present-and-null, absent
/// (`docs/v5/market-safety.md` 當期交易時段不得公開).
#[test]
fn pending_session_omits_daily_action_disclosure() {
    let documents = documents();
    let paper = document_named(&documents, "archive/paper.json");
    let records = paper["historicalActionFills"]
        .as_array()
        .expect("historicalActionFills is an array");
    assert_eq!(records.len(), SESSION_COUNT);

    let mut pending = 0_usize;
    for record in records {
        let object = record.as_object().expect("a record is an object");
        let trading_date = as_str(record, "tradingDate");
        match as_str(record, "marketSessionFinalityState").as_str() {
            "accepted" => assert!(
                object.contains_key("dailyActionDisclosure"),
                "{trading_date} has accepted finality and must disclose"
            ),
            "pending" => {
                pending += 1;
                assert_eq!(trading_date, IN_SESSION_DATE);
                assert!(
                    !object.contains_key("dailyActionDisclosure"),
                    "{trading_date} leaked a same-day disclosure"
                );
                assert_eq!(as_str(record, "recordDataState"), "HELD");
            }
            other => panic!("unknown finality state {other}"),
        }
    }
    assert_eq!(pending, 1, "exactly one session is still in progress");
}

/// Every paper figure carries an as-of, and no paper figure is dated to the
/// unsettled in-session day. Currently-visible figures are all dated to the
/// previous accepted close; a settled journal chapter is dated to its own
/// accepted close, which is the moment its number was true.
#[test]
fn every_paper_figure_uses_the_previous_close_as_of() {
    let documents = documents();

    let close_up = document_named(&documents, "close-up.json");
    assert_eq!(
        as_str(&close_up["recentConsequenceHighlight"], "asOf"),
        PREVIOUS_CLOSE
    );

    let paper = document_named(&documents, "archive/paper.json");
    assert_eq!(as_str(&paper, "asOf"), PREVIOUS_CLOSE);
    assert_eq!(as_str(&paper["account"], "asOf"), PREVIOUS_CLOSE);
    let position = &paper["positions"][0];
    assert_eq!(as_str(position, "markAsOf"), PREVIOUS_CLOSE);
    // The lot book last changed at the S12 reduction's close. It is a
    // settled change, not a mark, so it is dated there -- and never later
    // than the previous accepted close.
    assert_eq!(as_str(position, "lastChangedAt"), LAST_POSITION_CHANGE);
    assert!(LAST_POSITION_CHANGE < PREVIOUS_CLOSE);

    let archive = document_named(&documents, "archive.json");
    for section in archive["sections"]
        .as_array()
        .expect("sections is an array")
    {
        assert_eq!(as_str(section, "asOf"), PREVIOUS_CLOSE);
    }

    // A settled chapter is dated by its own accepted close.
    let journal = document_named(&documents, "life-journal.json");
    for entry in journal["entries"].as_array().expect("entries is an array") {
        let chapter_date = as_str(entry, "chapterDate");
        if let Some(paper_consequence) = entry["consequence"].get("paperConsequence") {
            assert_eq!(
                as_str(paper_consequence, "asOf"),
                format!("{chapter_date}T13:30:00+08:00"),
                "{chapter_date}: a chapter's paper figure is dated by its own close"
            );
        }
    }

    // And nothing anywhere is dated to the day whose finality is pending.
    for (path, document) in &documents {
        let mut found = Vec::new();
        collect_strings(
            document,
            &["asOf", "markAsOf", "lastChangedAt", "filledAt", "sealedAt", "appliedAt"],
            &mut found,
        );
        for (key, value) in found {
            assert!(
                !value.starts_with(IN_SESSION_DATE),
                "{path}: {key} is dated to the unsettled session ({value})"
            );
        }
    }
}

/// Twenty-nine settled chapters, one per accepted session, in strictly
/// increasing date order; today is not in the journal.
#[test]
fn the_journal_has_one_chapter_per_settled_session_in_date_order() {
    let documents = documents();
    let journal = document_named(&documents, "life-journal.json");
    let entries = journal["entries"].as_array().expect("entries is an array");
    assert_eq!(entries.len(), CHAPTER_COUNT);
    assert_eq!(CHAPTER_COUNT, 29);
    let dates: Vec<String> = entries.iter().map(|entry| as_str(entry, "chapterDate")).collect();
    for pair in dates.windows(2) {
        assert!(pair[0] < pair[1], "chapter dates must strictly increase: {pair:?}");
    }
    let settled: Vec<&str> = SESSIONS
        .iter()
        .filter(|session| session.finality_accepted)
        .map(|session| session.market_date_taipei)
        .collect();
    assert_eq!(dates, settled);
    assert!(!dates.contains(&IN_SESSION_DATE.to_owned()));
}

/// The chapter of the session that appended a relationship signal points at
/// that dyad stream, and no other chapter points at any dyad.
#[test]
fn only_the_blame_chapter_points_at_the_relationship_dyad() {
    let documents = documents();
    let journal = document_named(&documents, "life-journal.json");
    let with_dyad: Vec<String> = journal["entries"]
        .as_array()
        .expect("entries is an array")
        .iter()
        .filter(|entry| {
            !entry["archiveRefs"]["relationshipDyadRefs"]
                .as_array()
                .expect("relationshipDyadRefs is an array")
                .is_empty()
        })
        .map(|entry| as_str(entry, "chapterDate"))
        .collect();
    assert_eq!(with_dyad.len(), 1, "exactly one chapter carries the relationship signal");
    // No paper figure or claim anywhere quotes a line for her: the only
    // sealed utterances in the journal are his.
    let paper = document_named(&documents, "archive/paper.json");
    assert!(
        paper["positions"][0]["influencedByCharacterRefs"]
            .as_array()
            .expect("influencedByCharacterRefs is an array")
            .is_empty()
    );
}


// -- evidence card, held chapters, one hash per sentence, archive provenance --

fn hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut text, byte| {
        let _ = write!(text, "{byte:02x}");
        text
    })
}

/// A canonical 16-byte id as the lowercase hyphenated UUID the API renders.
fn uuid_of(bytes: &[u8]) -> String {
    let text = hex(bytes);
    format!(
        "{}-{}-{}-{}-{}",
        &text[0..8],
        &text[8..12],
        &text[12..16],
        &text[16..20],
        &text[20..32]
    )
}

/// The canonical utterance text hash, recomputed from the bytes shown: the
/// domain-separated SHA-256 `UtteranceArtifact::canonical_text_sha256`
/// seals (`PSZS/UTTERANCE_TEXT/v1\0` || UTF-8 text), in lowercase hex.
fn canonical_text_hash(text: &str) -> String {
    hex(&UtteranceArtifact::canonical_text_sha256(text))
}

/// Every `(utteranceArtifactId, canonicalTextSha256, canonicalTextUtf8?)`
/// reference anywhere under `value`.
fn utterance_references(value: &Value, found: &mut Vec<(String, String, Option<String>)>) {
    match value {
        Value::Object(map) => {
            if let (Some(id), Some(hash)) = (
                map.get("utteranceArtifactId").and_then(Value::as_str),
                map.get("canonicalTextSha256").and_then(Value::as_str),
            ) {
                found.push((
                    id.to_owned(),
                    hash.to_owned(),
                    map.get("canonicalTextUtf8")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                ));
            }
            map.values()
                .for_each(|child| utterance_references(child, found));
        }
        Value::Array(items) => items
            .iter()
            .for_each(|item| utterance_references(item, found)),
        _ => {}
    }
}

fn session_date(session_index: usize) -> &'static str {
    SESSIONS[session_index - 1].market_date_taipei
}

fn entry_for<'a>(journal: &'a Value, date: &str) -> Option<&'a Value> {
    journal["entries"]
        .as_array()
        .expect("entries is an array")
        .iter()
        .find(|entry| entry["chapterDate"] == date)
}

/// Every string value anywhere under `value`.
fn all_strings(value: &Value, found: &mut Vec<String>) {
    match value {
        Value::String(text) => found.push(text.clone()),
        Value::Array(items) => items.iter().for_each(|item| all_strings(item, found)),
        Value::Object(map) => map.values().for_each(|child| all_strings(child, found)),
        _ => {}
    }
}

/// When a chapter's rich narrative fails, the chapter still publishes: no
/// narrative segments, `evidence_card_only`, and a typed evidence card whose
/// numbers are the paper archive's numbers for the same trading day and
/// whose quotes are the sealed artifacts, byte for byte.
#[test]
#[allow(clippy::too_many_lines)]
fn evidence_card_survives_narrative_failure() {
    // S2 opened the position with a public claim; S12 reduced it at a real
    // loss with a self-acknowledgement; S20 pinned a loss on a colleague and
    // left a relationship signal.
    let failed: BTreeSet<usize> = [2, 12, 20].into_iter().collect();
    let degraded = documents_with(&ProjectionFaults {
        narrative_failed_chapters: failed.clone(),
        held_chapters: BTreeSet::new(),
    });
    let healthy = documents();
    let degraded_journal = document_named(&degraded, "life-journal.json");
    let healthy_journal = document_named(&healthy, "life-journal.json");
    let paper = document_named(&healthy, "archive/paper.json");
    assert_eq!(
        paper,
        document_named(&degraded, "archive/paper.json"),
        "a narrative failure never touches the paper archive"
    );

    let degraded_entries = degraded_journal["entries"].as_array().expect("entries");
    assert_eq!(degraded_entries.len(), CHAPTER_COUNT);
    let failed_dates: Vec<&str> = failed.iter().map(|index| session_date(*index)).collect();

    let mut checked = 0_usize;
    let mut realized_total = 0_i64;
    for degraded_entry in degraded_entries {
        let date = as_str(degraded_entry, "chapterDate");
        let healthy_entry = entry_for(&healthy_journal, &date).expect("same chapters");
        if let Some(realized) = degraded_entry["evidenceCard"]["paperOutcome"]["realizedPnlMinorUnits"].as_i64() {
            realized_total += realized;
        }
        if !failed_dates.contains(&date.as_str()) {
            assert_eq!(degraded_entry, healthy_entry, "{date}: an unfaulted chapter is untouched");
            continue;
        }
        checked += 1;
        assert_eq!(healthy_entry["narrativeState"], "composed");
        assert_eq!(degraded_entry["narrativeState"], "evidence_card_only", "{date}");
        assert_eq!(
            degraded_entry["narrativeSegments"],
            Value::Array(Vec::new()),
            "{date}: a failed narrative carries no segments"
        );
        // Not one sentence of the sealed narrative leaks into the entry.
        let degraded_text = degraded_entry.to_string();
        for segment in healthy_entry["narrativeSegments"].as_array().expect("segments") {
            if segment["kind"] == "narrator" {
                let text = as_str(segment, "text");
                assert!(!degraded_text.contains(&text), "{date}: narrative text leaked: {text}");
            }
        }

        // The card survives whole, identical to the healthy chapter's card.
        let card = &degraded_entry["evidenceCard"];
        assert_eq!(card, &healthy_entry["evidenceCard"], "{date}: the card must not degrade");
        assert_eq!(
            degraded_entry["relationshipConsequence"], healthy_entry["relationshipConsequence"],
            "{date}: the relationship consequence must not degrade"
        );

        // Its numbers are the paper archive's numbers for the same day.
        let record = paper["historicalActionFills"]
            .as_array()
            .expect("records")
            .iter()
            .find(|record| record["tradingDate"] == date.as_str())
            .unwrap_or_else(|| panic!("{date}: no paper record"));
        let disclosure = &record["dailyActionDisclosure"];
        let outcome = &card["paperOutcome"];
        assert_eq!(card["action"]["kind"], disclosure["action"], "{date}: action");
        if disclosure["fill"].is_null() {
            assert!(outcome["filledQuantityFixed6"].is_null(), "{date}: no fill, no quantity");
            assert!(outcome["fillPriceSourceRef"].is_null(), "{date}: no fill, no price source");
        } else {
            assert_eq!(outcome["filledQuantityFixed6"], disclosure["quantityFixed6"], "{date}: quantity");
            assert_eq!(
                outcome["sealedPriceMinorUnitsFixed6"], disclosure["fill"]["sealedPriceMinorUnitsFixed6"],
                "{date}: sealed price"
            );
            assert_eq!(
                outcome["fillPriceSourceRef"], disclosure["fill"]["sealedPriceRevisionRef"],
                "{date}: price source"
            );
        }
        let chapter_paper = &healthy_entry["consequence"]["paperConsequence"];
        assert_eq!(
            outcome["unrealizedPnlMinorUnits"], chapter_paper["unrealizedPnlMinorUnits"],
            "{date}: unrealized"
        );
        assert_eq!(outcome["asOf"], chapter_paper["asOf"], "{date}: as-of");

        // Quotes are the sealed artifacts, verbatim, with the same hash the
        // healthy chapter shows for them.
        let quotes = card["quotedUtterances"].as_array().expect("quotes");
        assert_eq!(quotes.len(), 1, "{date}: each of these chapters sealed one artifact");
        for quote in quotes {
            let text = as_str(quote, "canonicalTextUtf8");
            assert_eq!(as_str(quote, "canonicalTextSha256"), canonical_text_hash(&text), "{date}");
            let healthy_quote = if quote["surface"] == "self_acknowledged" {
                &healthy_entry["currentSelfNarration"]
            } else {
                &healthy_entry["contemporaneousClaim"]
            };
            for key in ["utteranceArtifactId", "canonicalTextSha256", "canonicalTextUtf8"] {
                assert_eq!(quote[key], healthy_quote[key], "{date}: {key}");
            }
        }
        for key in ["contemporaneousClaim", "currentSelfNarration"] {
            assert_eq!(degraded_entry[key], healthy_entry[key], "{date}: artifacts are unaffected");
        }
        // No first-person補話 anywhere on the card.
        let mut strings = Vec::new();
        all_strings(card, &mut strings);
        for text in strings {
            if quotes.iter().any(|quote| quote["canonicalTextUtf8"] == text.as_str()) {
                continue;
            }
            assert!(!text.contains('我'), "{date}: the card speaks in the first person: {text}");
        }
    }
    assert_eq!(checked, failed.len());
    // Across every chapter's card, the realized figures add up to the
    // position's realized P&L: nothing is dropped when a narrative fails.
    assert_eq!(
        Some(realized_total),
        paper["positions"][0]["realizedPnlMinorUnits"].as_i64()
    );
}

/// A held chapter is an id, a date and a label -- nothing else, and none of
/// its content reaches the journal document at all.
#[test]
fn held_entry_leaks_no_content() {
    let blame_session = 20;
    let date = session_date(blame_session);
    let healthy = documents();
    let healthy_journal = document_named(&healthy, "life-journal.json");
    assert_eq!(healthy_journal["heldEntries"], Value::Array(Vec::new()));
    let healthy_entry = entry_for(&healthy_journal, date).expect("the blame chapter");

    let held: BTreeSet<usize> = [blame_session].into_iter().collect();
    for faults in [
        ProjectionFaults {
            narrative_failed_chapters: BTreeSet::new(),
            held_chapters: held.clone(),
        },
        // Holding wins over a narrative failure on the same chapter.
        ProjectionFaults {
            narrative_failed_chapters: held.clone(),
            held_chapters: held.clone(),
        },
    ] {
        let documents = documents_with(&faults);
        let journal = document_named(&documents, "life-journal.json");
        let held_entries = journal["heldEntries"].as_array().expect("heldEntries");
        assert_eq!(held_entries.len(), 1);
        let held_entry = held_entries[0].as_object().expect("an object");
        let keys: BTreeSet<&str> = held_entry.keys().map(String::as_str).collect();
        assert_eq!(
            keys,
            ["chapterDate", "entryId", "entryVisibility", "heldReasonLabel"]
                .into_iter()
                .collect(),
            "a held entry carries a label and nothing else"
        );
        assert_eq!(held_entry["entryVisibility"], "HELD");
        assert_eq!(held_entry["chapterDate"], date);
        assert_eq!(held_entry["entryId"], healthy_entry["entryId"]);
        assert!(entry_for(&journal, date).is_none(), "a held chapter is not an entry");
        assert_eq!(
            journal["entries"].as_array().expect("entries").len(),
            CHAPTER_COUNT - 1
        );

        let raw = journal.to_string();
        let leaks = [
            as_str(healthy_entry, "sceneSummary"),
            as_str(healthy_entry, "openQuestionSummary"),
            as_str(&healthy_entry["contemporaneousClaim"], "canonicalTextUtf8"),
            as_str(&healthy_entry["contemporaneousClaim"], "utteranceArtifactId"),
            as_str(&healthy_entry["relationshipConsequence"], "relationshipSignalRef"),
            as_str(&healthy_entry["relationshipConsequence"], "summary"),
            healthy_entry["archiveRefs"]["relationshipDyadRefs"][0]
                .as_str()
                .expect("the blame chapter points at the dyad")
                .to_owned(),
        ];
        for leak in leaks {
            assert!(!raw.contains(&leak), "held chapter content leaked: {leak}");
        }
    }
}

/// The same sealed sentence reports the same artifact id and the same
/// `canonicalTextSha256` on every surface, and that hash is the canonical
/// (domain-separated) SHA-256 of the bytes shown -- no renderer, card or
/// archive page rewrote it.
#[test]
fn utterance_hash_identical_across_world_closeup_journal_archive() {
    let slice = one_character_slice();
    // The log's own sealed artifacts: id -> (hash, text).
    let mut sealed: BTreeMap<String, (String, String)> = BTreeMap::new();
    for event in slice.events.iter().filter(|event| event.event_type == "PublicClaimMade") {
        let artifact = decode_canonical::<character::v1::UtteranceArtifactV1>(&event.payload_bytes)
            .expect("canonical artifact");
        sealed.insert(
            uuid_of(&artifact.utterance_artifact_id),
            (hex(&artifact.canonical_text_sha256), artifact.canonical_text_utf8),
        );
    }
    assert_eq!(sealed.len(), 5);

    let documents = documents();
    let mut surfaces: BTreeMap<&str, BTreeSet<String>> = BTreeMap::new();
    for (path, document) in &documents {
        let surface = if path.ends_with("world.json") {
            "world"
        } else if path.ends_with("close-up.json") {
            "close-up"
        } else if path.ends_with("life-journal.json") {
            "life-journal"
        } else if path.contains("/archive") {
            "archive"
        } else {
            "index"
        };
        let mut found = Vec::new();
        utterance_references(document, &mut found);
        for (id, hash, text) in found {
            let (sealed_hash, sealed_text) = sealed
                .get(&id)
                .unwrap_or_else(|| panic!("{path}: cites an unsealed artifact {id}"));
            assert_eq!(&hash, sealed_hash, "{path}: {id} reports a different hash");
            let text = text.unwrap_or_else(|| panic!("{path}: {id} is cited without its bytes"));
            assert_eq!(&text, sealed_text, "{path}: {id} was rewritten");
            assert_eq!(canonical_text_hash(&text), hash, "{path}: {id} hash is not the canonical sha256 of its bytes");
            surfaces.entry(surface).or_default().insert(id.clone());
            if path.ends_with("archive/relations.json") {
                surfaces.entry("archive/relations").or_default().insert(id);
            }
        }
    }
    // Every sealed sentence is reachable from the journal; the close-up, the
    // relations page and the paper archive each carry at least one.
    assert_eq!(surfaces["life-journal"], sealed.keys().cloned().collect());
    assert!(!surfaces["close-up"].is_empty());
    assert!(!surfaces["archive"].is_empty());
    assert!(!surfaces["archive/relations"].is_empty());
    // The world snapshot has no speech surface today (he has said nothing in
    // the open session), so it cites no artifact -- and it may not carry any
    // sealed sentence as unattributed copy either.
    assert!(!surfaces.contains_key("world"));
    let world = document_named(&documents, "world.json");
    let mut world_strings = Vec::new();
    all_strings(&world, &mut world_strings);
    for (_, text) in sealed.values() {
        assert!(
            world_strings.iter().all(|string| !string.contains(text.as_str())),
            "world.json carries a sealed sentence without its artifact"
        );
    }
}

const SECTION_KEYS: [&str; 5] = ["relations", "chart", "traits", "memories", "life"];

/// Envelope and page-level keys that are not archive items.
const NON_ITEM_KEYS: [&str; 7] = [
    "sourceRevisionSet",
    "truthClasses",
    "sourceRefs",
    "evidenceSessions",
    "activeSessions",
    "involvedPeople",
    "consequenceMemoryRefs",
];

/// Every archive item: each object value of a top-level content key, and
/// each object element of any array, recursively (skipping the helper
/// lists in `NON_ITEM_KEYS`).
fn archive_items<'a>(value: &'a Value, top_level: bool, items: &mut Vec<&'a Value>) {
    let Value::Object(map) = value else {
        return;
    };
    for (key, child) in map {
        if NON_ITEM_KEYS.contains(&key.as_str()) {
            continue;
        }
        match child {
            Value::Object(_) if top_level => {
                items.push(child);
                archive_items(child, false, items);
            }
            Value::Array(elements) => {
                for element in elements {
                    if element.is_object() {
                        items.push(element);
                        archive_items(element, false, items);
                    }
                }
            }
            Value::Object(_) => archive_items(child, false, items),
            _ => {}
        }
    }
}

fn object_keys(value: &Value, keys: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                keys.push(key.clone());
                object_keys(child, keys);
            }
        }
        Value::Array(items) => items.iter().for_each(|item| object_keys(item, keys)),
        _ => {}
    }
}

/// Each of the five section pages exists at its own route, and every item on
/// it carries a truth class the page declares plus at least one source that
/// resolves: a canonical event whose type matches the event at that exact
/// global log position, or a named chassis anchor.
#[test]
#[allow(clippy::too_many_lines)]
fn archive_sections_every_item_has_truth_class_and_source_refs() {
    let slice = one_character_slice();
    let documents = documents();
    let index = document_named(&documents, "index.json");
    let character_id = as_str(&index, "characterId");
    assert_eq!(index["routes"].as_object().expect("routes").len(), 10);

    let archive = document_named(&documents, "archive.json");
    for section in archive["sections"].as_array().expect("sections") {
        let key = as_str(section, "sectionKey");
        assert_eq!(
            as_str(section, "sectionPath"),
            format!("/api/v2/characters/{character_id}/archive/{key}"),
            "{key}: every section links to its own page"
        );
    }

    for key in SECTION_KEYS {
        let document = document_named(&documents, &format!("archive/{key}.json"));
        assert_eq!(as_str(&document, "sectionKey"), key);
        assert_eq!(as_str(&document, "appliedAudienceScope"), "subscriber_archive");
        assert_eq!(
            index["routes"][format!("/api/v2/characters/{character_id}/archive/{key}")],
            format!("v2/characters/{character_id}/archive/{key}.json")
        );
        let declared: Vec<&str> = document["truthClasses"]
            .as_array()
            .expect("truthClasses")
            .iter()
            .map(|class| class.as_str().expect("a string"))
            .collect();

        let mut items = Vec::new();
        archive_items(&document, true, &mut items);
        assert!(items.len() >= 3, "{key}: a section page has content");
        for item in items {
            let truth_class = item["truthClass"]
                .as_str()
                .unwrap_or_else(|| panic!("{key}: item without truthClass: {item}"));
            assert!(
                ["fictional_setting", "symbolic_interpretation", "simulated_narrative"]
                    .contains(&truth_class),
                "{key}: forbidden truth class {truth_class}"
            );
            assert!(declared.contains(&truth_class), "{key}: undeclared truth class {truth_class}");
            let refs = item["sourceRefs"]
                .as_array()
                .unwrap_or_else(|| panic!("{key}: item without sourceRefs: {item}"));
            assert!(!refs.is_empty(), "{key}: empty sourceRefs on {item}");
            for source in refs {
                match source["kind"].as_str() {
                    Some("canonical_event") => {
                        let position = source["globalPosition"]
                            .as_u64()
                            .and_then(|position| usize::try_from(position).ok())
                            .expect("a canonical ref has a global position");
                        let event = slice
                            .events
                            .get(position - 1)
                            .unwrap_or_else(|| panic!("{key}: position {position} is past the log"));
                        assert_eq!(source["eventType"], event.event_type, "{key}: position {position}");
                        assert_eq!(as_str(source, "refId"), uuid_of(&event.stream_id));
                    }
                    Some("character_seed") => {
                        assert!(source["eventType"].is_null() && source["globalPosition"].is_null());
                        assert!(as_str(source, "refId").starts_with("character-seed/v1#"));
                    }
                    other => panic!("{key}: unknown source kind {other:?}"),
                }
            }
        }

        // No score, total, rank or ticker field; no raw acquaintance key.
        let mut keys = Vec::new();
        object_keys(&document, &mut keys);
        for field in keys {
            let lower = field.to_lowercase();
            for banned in ["rank", "score", "total", "winrate", "leaderboard", "ticker"] {
                assert!(!lower.contains(banned), "{key}: banned field {field}");
            }
        }
        assert!(
            !document.to_string().contains(seed::ACQUAINTANCE_XIAOYU.acquaintance_id),
            "{key}: exposes a raw acquaintance key"
        );
    }

    let chart = document_named(&documents, "archive/chart.json");
    for motif in chart["motifs"].as_array().expect("motifs") {
        assert_eq!(motif["truthClass"], "symbolic_interpretation");
        assert!(as_str(motif, "effectScopeLabel").contains("不影響價格或績效"));
    }
    let memories = document_named(&documents, "archive/memories.json");
    for memory in memories["memories"].as_array().expect("memories") {
        assert_ne!(memory["visibility"], "canonical_restricted");
    }
}

/// A `canonical_restricted` memory never leaves the canonical store: not on
/// the memories page, not as a ref from a chapter, a card, a relationship
/// consequence or a life milestone.
#[test]
fn restricted_memories_never_reach_any_document() {
    let mut slice = one_character_slice();
    // One origin memory and the relationship memory the S20 signal formed.
    let restricted = [slice.ids.memory_ids[0], slice.ids.memory_ids[8]];
    let mut rewritten = 0;
    for event in slice.events.iter_mut().filter(|event| event.event_type == "MemoryFormed") {
        let mut memory = decode_canonical::<character::v1::MemoryFormedV1>(&event.payload_bytes)
            .expect("canonical memory");
        if restricted.iter().any(|id| memory.memory_id == id) {
            memory.visibility =
                character::v1::memory_formed_v1::Visibility::CanonicalRestricted as i32;
            event.payload_bytes = canonical_bytes(&memory);
            rewritten += 1;
        }
    }
    assert_eq!(rewritten, 2);

    let healthy = public_api_documents(&one_character_slice());
    let documents = public_api_documents(&slice);
    for id in restricted {
        let uuid = uuid_of(&id);
        assert!(
            healthy.iter().any(|(_, text)| text.contains(&uuid)),
            "the unrestricted projection does show {uuid}, so its absence below is meaningful"
        );
        for (path, text) in &documents {
            assert!(!text.contains(&uuid), "{path} leaks restricted memory {uuid}");
        }
    }
}
