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
//! integrity, the same-day disclosure fence, and the as-of fence.

use std::{fs, path::PathBuf};

use panshi_character_episode::{
    public_api::public_api_documents,
    slice::{
        one_character_slice,
        sessions::{SESSIONS, SESSION_COUNT},
    },
};
use serde_json::Value;

/// The last accepted close. Every currently-visible paper figure in the
/// slice is dated here, never to the in-session day.
const PREVIOUS_CLOSE: &str = "2026-03-17T13:30:00+08:00";

/// Today, whose finality is still pending. No paper figure may be dated to
/// it.
const IN_SESSION_DATE: &str = "2026-03-18";

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
    public_api_documents(&one_character_slice())
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
    assert_eq!(first.len(), 6);
    assert_eq!(first, second, "two folds of the same log must be identical");
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
    assert_eq!(as_str(position, "lastChangedAt"), PREVIOUS_CLOSE);

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
