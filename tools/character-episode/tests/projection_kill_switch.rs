//! Projection kill switches (`docs/v5/market-safety.md` "Kill switch").
//!
//! The rule under test: an object a switch withdraws must not be
//! recoverable from anything still public -- not its quantity, direction,
//! date or existence -- while what is not market-derived keeps running
//! (關閉市場投影後，公共世界仍可運行生活、關係、記憶). The projection reduces every
//! switch to one world-level horizon and, from it on, withholds every object
//! whose causal provenance is market-derived (`src/public_api/gate.rs`).
//!
//! `assert_horizon` states that invariant over all ten documents against the
//! unswitched baseline, reading provenance and positions straight off the
//! canonical log rather than off the gate. The `infer_*` tests then try to
//! recover a withdrawn object from what is left -- cash, versions, adjacent
//! chapters, a sentence on another page, the response shape, the log
//! position, the surviving life items -- and must fail to.

use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::OnceLock,
};

use panshi_character_episode::{
    public_api::{
        ProjectionFaults,
        kill_switch::{KillSwitchOrigin, KillSwitchSource, ProjectionKillSwitch, SLICE_KILL_SWITCH_PATH, SwitchState},
        public_api_documents, public_api_documents_gated,
    },
    slice::{CharacterSlice, one_character_slice, seed, sessions::ManifestModeDomain},
};
use panshi_protocol::{decode_canonical, story, world};
use serde_json::{Value, json};

const KILL_SWITCH_HELD: &str = "這一章的市場內容依發布規則暫停公開；人物的生活、關係與記憶照常。";
const MARKET_CLOSURE: &str = "這一頁有部分市場內容依發布規則暫停顯示；人物的生活、關係與記憶照常。";
const SUMMARY_HELD: &str = "這一節的摘要含有依發布規則暫停顯示的市場內容。";
const LIST_CLOSED: &str = "這份清單的市場內容依發布規則暫停顯示。";

const SECTIONS: [&str; 5] = [
    "archive/relations.json",
    "archive/chart.json",
    "archive/traits.json",
    "archive/memories.json",
    "archive/life.json",
];

/// Envelope fields that legitimately differ between kill-switch states: the
/// provenance list and, under a horizon, the reported log position.
const PROVENANCE_KEYS: [&str; 3] = ["sourceRevisionSet", "projectionVersion", "sourceGlobalPosition"];

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

type Documents = BTreeMap<String, Value>;

fn parse(documents: Vec<(String, String)>) -> Documents {
    documents
        .into_iter()
        .map(|(path, text)| {
            let value = serde_json::from_str(&text)
                .unwrap_or_else(|error| panic!("{path} is not JSON: {error}"));
            (path, value)
        })
        .collect()
}

fn project(slice: &CharacterSlice, switches: &ProjectionKillSwitch) -> Documents {
    parse(public_api_documents_gated(slice, &ProjectionFaults::default(), switches))
}

fn baseline() -> Documents {
    static BASELINE: OnceLock<Documents> = OnceLock::new();
    BASELINE
        .get_or_init(|| parse(public_api_documents(&one_character_slice())))
        .clone()
}

/// The slice, built once per test binary.
fn slice() -> &'static CharacterSlice {
    static SLICE: OnceLock<CharacterSlice> = OnceLock::new();
    SLICE.get_or_init(one_character_slice)
}

fn doc<'a>(documents: &'a Documents, suffix: &str) -> &'a Value {
    documents
        .iter()
        .find(|(path, _)| path.ends_with(suffix))
        .map_or_else(|| panic!("no document ending in {suffix}"), |(_, value)| value)
}

/// A published set (revision 2) with one change applied.
fn set_with(change: impl FnOnce(&mut ProjectionKillSwitch)) -> ProjectionKillSwitch {
    let mut set = ProjectionKillSwitch::release_gate_default();
    set.origin = KillSwitchOrigin::Published;
    set.revision = 2;
    change(&mut set);
    set
}

fn open_current_market() -> ProjectionKillSwitch {
    set_with(|set| set.current_market_projection = SwitchState::Open)
}

fn body(value: &Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .filter(|(key, _)| !PROVENANCE_KEYS.contains(&key.as_str()))
                .map(|(key, child)| (key.clone(), body(child)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(body).collect()),
        other => other.clone(),
    }
}

fn bodies(documents: &Documents) -> BTreeMap<String, Value> {
    documents.iter().map(|(path, value)| (path.clone(), body(value))).collect()
}

fn without(value: &Value, keys: &[&str]) -> Value {
    let mut value = body(value);
    let object = value.as_object_mut().expect("a document is an object");
    for key in keys {
        object.remove(*key);
    }
    value
}

fn all_text(documents: &Documents) -> String {
    documents
        .values()
        .map(|value| serde_json::to_string(value).expect("serializable"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn settled_dates() -> Vec<String> {
    slice()
        .sessions
        .iter()
        .filter(|session| session.finality_accepted)
        .map(|session| session.market_date_taipei.to_owned())
        .collect()
}

/// Read off the canonical log: the number of events before the session of
/// `date` began (its `FactManifestAccepted` is the next event).
fn events_before(date: &str) -> u64 {
    let offset = slice()
        .events
        .iter()
        .position(|event| {
            event.event_type == "FactManifestAccepted"
                && decode_canonical::<world::v1::FactManifestAcceptedV1>(&event.payload_bytes)
                    .expect("manifest")
                    .market_date_taipei
                    == date
        })
        .unwrap_or_else(|| panic!("no session on {date}"));
    u64::try_from(offset).expect("fits")
}

/// Read off the canonical log: for every composed chapter (by its id as a
/// UUID string), the narrator segments whose own sealed `source_refs` are
/// the chassis motif alone, as `(segmentId, text)`.
fn chassis_segments() -> BTreeMap<String, Vec<(String, String)>> {
    let mut out = BTreeMap::new();
    for event in &slice().events {
        if event.event_type != "StoryChapterComposed" {
            continue;
        }
        let chapter = decode_canonical::<story::v1::StoryChapterComposedV1>(&event.payload_bytes).expect("chapter");
        let id = uuid(&chapter.chapter_id);
        let segments = chapter
            .segments
            .iter()
            .filter_map(|segment| match &segment.variant {
                Some(story::v1::narrative_segment_v1::Variant::NarratorText(text))
                    if text.source_refs == [seed::MOTIF_CONTROL_AND_RECOGNITION.motif_id] =>
                {
                    Some((segment.segment_id.clone(), text.text.clone()))
                }
                _ => None,
            })
            .collect();
        out.insert(id, segments);
    }
    out
}

fn uuid(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let hex: String = bytes
        .iter()
        .flat_map(|byte| [char::from(DIGITS[usize::from(byte >> 4)]), char::from(DIGITS[usize::from(byte & 0x0f)])])
        .collect();
    format!("{}-{}-{}-{}-{}", &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32])
}

/// An item whose provenance is the chassis alone.
fn chassis_only(item: &Value) -> bool {
    item.get("sourceRefs")
        .and_then(Value::as_array)
        .is_some_and(|refs| !refs.is_empty() && refs.iter().all(|reference| reference["kind"] == "character_seed"))
}

/// Every `(key, date)` under a date-carrying key, skipping `heldEntries`
/// (whose job is to say which day is held) and chassis-only items.
fn dated_values(value: &Value, out: &mut Vec<(String, String)>) {
    const DATE_KEYS: [&str; 6] = ["sessionDate", "chapterDate", "tradingDate", "formedAt", "sealedAt", "observedAt"];
    match value {
        Value::Object(object) => {
            if chassis_only(value) {
                return;
            }
            for (key, child) in object {
                if key == "heldEntries" {
                    continue;
                }
                if DATE_KEYS.contains(&key.as_str())
                    && let Some(text) = child.as_str()
                {
                    out.push((key.clone(), text.to_owned()));
                }
                dated_values(child, out);
            }
        }
        Value::Array(items) => items.iter().for_each(|item| dated_values(item, out)),
        _ => {}
    }
}

/// Like `dated_values`, but without skipping anything.
fn every_date(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Object(object) => {
            for (key, child) in object {
                if matches!(key.as_str(), "sessionDate" | "formedAt")
                    && let Some(text) = child.as_str()
                {
                    out.push(text.to_owned());
                }
                every_date(child, out);
            }
        }
        Value::Array(items) => items.iter().for_each(|item| every_date(item, out)),
        _ => {}
    }
}

fn global_positions(value: &Value, out: &mut Vec<u64>) {
    match value {
        Value::Object(object) => {
            for (key, child) in object {
                if key == "globalPosition"
                    && let Some(position) = child.as_u64()
                {
                    out.push(position);
                }
                global_positions(child, out);
            }
        }
        Value::Array(items) => items.iter().for_each(|item| global_positions(item, out)),
        _ => {}
    }
}

/// A date or timestamp before the horizon session, which begins at its
/// 09:00 interaction cutoff (Asia/Taipei).
fn before_horizon(value: &str, horizon: &str) -> bool {
    if value.len() > 10 {
        value < format!("{horizon}T09:00:00+08:00").as_str()
    } else {
        value < horizon
    }
}

/// The artifact ids and texts of every sentence sealed on or after `date`.
fn sentences_from(date: &str) -> Vec<(String, String)> {
    let base = baseline();
    let journal = doc(&base, "life-journal.json");
    let mut out = Vec::new();
    for entry in journal["entries"].as_array().expect("entries") {
        if entry["chapterDate"].as_str().expect("date") < date {
            continue;
        }
        for quoted in entry["evidenceCard"]["quotedUtterances"].as_array().expect("quotes") {
            out.push((
                quoted["utteranceArtifactId"].as_str().expect("id").to_owned(),
                quoted["canonicalTextUtf8"].as_str().expect("text").to_owned(),
            ));
        }
    }
    out
}

// -- the invariant ----------------------------------------------------------

/// Everything a projection whose horizon is `horizon` (a trading date) may
/// and must show, against the unswitched baseline. One flat statement over
/// all ten documents reads better than ten helpers, hence the length.
#[allow(clippy::too_many_lines)]
fn assert_horizon(base: &Documents, gated: &Documents, horizon: &str) {
    let position_before = events_before(horizon);

    // Life journal: chapters before the horizon byte-identical; the rest
    // held by their own id with the fixed label, carrying verbatim exactly
    // the segments whose sealed provenance is the chassis.
    let base_journal = doc(base, "life-journal.json");
    let journal = doc(gated, "life-journal.json");
    let base_entries = base_journal["entries"].as_array().expect("entries");
    let kept: Vec<&Value> = base_entries
        .iter()
        .filter(|entry| entry["chapterDate"].as_str().expect("date") < horizon)
        .collect();
    assert_eq!(journal["entries"].as_array().expect("entries").iter().collect::<Vec<_>>(), kept);
    let chassis = chassis_segments();
    let expected_held: Vec<&Value> = base_entries
        .iter()
        .filter(|entry| entry["chapterDate"].as_str().expect("date") >= horizon)
        .collect();
    let held = journal["heldEntries"].as_array().expect("held");
    assert_eq!(held.len(), expected_held.len(), "every chapter from {horizon} on is held");
    for (held, base_entry) in held.iter().zip(expected_held) {
        let keys: BTreeSet<&str> = held.as_object().expect("held").keys().map(String::as_str).collect();
        assert!(
            keys.is_subset(&["chapterDate", "entryId", "entryVisibility", "heldReasonLabel", "nonMarketSegments"].into()),
            "{keys:?}"
        );
        assert_eq!(held["entryId"], base_entry["entryId"]);
        assert_eq!(held["chapterDate"], base_entry["chapterDate"]);
        assert_eq!(held["heldReasonLabel"], KILL_SWITCH_HELD);
        let expected: &[(String, String)] = &chassis[base_entry["entryId"].as_str().expect("id")];
        let shown: Vec<(String, String)> = held
            .get("nonMarketSegments")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .map(|segment| {
                assert!(chassis_only(segment), "a non-market segment cites only the chassis: {segment}");
                let base_segment = base_entry["narrativeSegments"]
                    .as_array()
                    .expect("segments")
                    .iter()
                    .find(|candidate| candidate["segmentId"] == segment["segmentId"])
                    .expect("the segment is one the chapter sealed");
                assert_eq!(segment["text"], base_segment["text"], "verbatim");
                assert_eq!(segment["truthClass"], base_segment["truthClass"]);
                (
                    segment["segmentId"].as_str().expect("id").to_owned(),
                    segment["text"].as_str().expect("text").to_owned(),
                )
            })
            .collect();
        assert_eq!(shown, expected, "exactly the chassis-sourced segments of {}", base_entry["chapterDate"]);
    }

    // Paper archive: no today's view; records and notes before the horizon
    // byte-identical; none from it on, not even a shell.
    let base_paper = doc(base, "archive/paper.json");
    let paper = doc(gated, "archive/paper.json");
    assert!(paper.get("account").is_none(), "account cash accumulates every fill");
    assert!(paper.get("paperVersionSet").is_none(), "stream versions count every change");
    assert_eq!(paper["positions"], json!([]));
    let kept_records: Vec<&Value> = base_paper["historicalActionFills"]
        .as_array()
        .expect("records")
        .iter()
        .filter(|record| record["tradingDate"].as_str().expect("date") < horizon)
        .collect();
    assert_eq!(paper["historicalActionFills"].as_array().expect("records").iter().collect::<Vec<_>>(), kept_records);
    for note in paper["dataRevisions"].as_array().expect("notes") {
        assert!(base_paper["dataRevisions"].as_array().expect("notes").contains(note));
        assert!(before_horizon(note["appliedAt"].as_str().expect("at"), horizon));
    }
    assert_eq!(paper["marketClosureReasonLabel"], MARKET_CLOSURE);

    // Close-up: identity, scene and pose only.
    let close_up = doc(gated, "close-up.json");
    let mut expected_close_up = without(
        doc(base, "close-up.json"),
        &[
            "currentVerbPhrase",
            "currentVerbPhraseTruthClass",
            "currentAttention",
            "unresolvedTensionSummary",
            "unresolvedTensionSummaryTruthClass",
            "publicClaim",
            "selfAcknowledgement",
            "recentConsequenceHighlight",
        ],
    );
    expected_close_up["unresolvedCommitments"] = json!([]);
    assert_eq!(without(close_up, &["marketClosureReasonLabel"]), expected_close_up);
    assert_eq!(close_up["marketClosureReasonLabel"], MARKET_CLOSURE);

    // Archive index: the history-folded layer is held; chassis summaries and
    // every entrance stay.
    let base_index = doc(base, "archive.json");
    let index = doc(gated, "archive.json");
    assert!(index.get("longTermTensionSummary").is_none());
    assert_eq!(index["recentHighlights"], json!([]));
    assert_eq!(index["recentHighlightTruthClasses"], json!([]));
    let sections = index["sections"].as_array().expect("sections");
    for (section, base_section) in sections.iter().zip(base_index["sections"].as_array().expect("sections")) {
        let key = section["sectionKey"].as_str().expect("key");
        assert_eq!(section["sectionPath"], base_section["sectionPath"], "{key}: entrance");
        if matches!(key, "chart" | "traits") {
            assert_eq!(body(section), body(base_section), "{key}: chassis summary");
        } else {
            assert_eq!(section["entryVisibility"], "HELD", "{key}");
            assert_eq!(section["summaryHeldReasonLabel"], SUMMARY_HELD);
            assert!(section.get("summary").is_none() && section.get("summaryTruthClass").is_none());
        }
    }
    assert_eq!(index["marketClosureReasonLabel"], MARKET_CLOSURE);

    // World: the resident and the clock stay; today's focus and acts go.
    let world = doc(gated, "v2/world.json");
    let position = &world["characterPositions"][0];
    assert!(position["focusHint"].is_null() && position["focusHintTruthClass"].is_null());
    assert_eq!(position["sourceEventRefs"], json!([]));
    assert_eq!(world["storyHooks"], json!([]));
    assert_eq!(world["marketClock"], doc(base, "v2/world.json")["marketClock"]);
    assert_eq!(world["marketClosureReasonLabel"], MARKET_CLOSURE);

    // Archive sections: an item is shown exactly when it is dated before the
    // horizon or its provenance is the chassis alone ("人物的生活、關係與記憶照常"
    // is true on every page that says it).
    for suffix in SECTIONS {
        assert_section_items(doc(base, suffix), doc(gated, suffix), horizon, suffix);
    }

    // Envelope and provenance: the reported position is the last one before
    // the horizon; no paper versions; no manifest of a withheld session; no
    // object anywhere cites an event from the horizon on.
    for (path, value) in gated {
        if path == "index.json" {
            continue;
        }
        assert_eq!(value["projectionVersion"], position_before, "{path}");
        assert_eq!(value["sourceGlobalPosition"], position_before, "{path}");
        assert_eq!(value["visibilityEpoch"], base[path]["visibilityEpoch"], "{path}: canonical epoch");
        for reference in value["sourceRevisionSet"].as_array().expect("refs") {
            let kind = reference["refKind"].as_str().expect("kind");
            assert!(!matches!(kind, "paper_account" | "paper_position"), "{path}: {kind} still listed");
            if kind == "world_fact_manifest" {
                let session = reference["revision"].as_u64().expect("rev");
                let horizon_session = slice()
                    .sessions
                    .iter()
                    .find(|session| session.market_date_taipei == horizon)
                    .expect("horizon session")
                    .session_index;
                assert!(session < u64::try_from(horizon_session).expect("fits"), "{path}: manifest {session}");
            }
        }
        let mut positions = Vec::new();
        global_positions(value, &mut positions);
        for cited in positions {
            assert!(cited <= position_before, "{path} cites event {cited} at or after the horizon ({position_before})");
        }
    }

    // Nothing market-derived (outside heldEntries) is dated from the
    // horizon on, and no sentence sealed from it on appears anywhere.
    let mut dated = Vec::new();
    for value in gated.values() {
        dated_values(value, &mut dated);
    }
    for (key, date) in &dated {
        assert!(before_horizon(date, horizon), "{key} {date} is at or after the horizon {horizon}");
    }
    let text = all_text(gated);
    for (id, sentence) in sentences_from(horizon) {
        assert!(!text.contains(&id), "sentence {id} sealed after the horizon still appears");
        assert!(!text.contains(&sentence), "sentence {sentence:?} still appears");
    }
}

const CONTAINER_LISTS: [&str; 2] = ["acquaintances", "motifs"];

fn section_items(value: &Value, out: &mut Vec<Value>) {
    if let Value::Object(object) = value {
        for (key, child) in object {
            match child {
                Value::Array(elements) if CONTAINER_LISTS.contains(&key.as_str()) => {
                    for element in elements {
                        section_items(element, out);
                    }
                }
                Value::Array(elements) if key != "sourceRevisionSet" && key != "truthClasses" => {
                    out.extend(elements.iter().map(body));
                }
                Value::Object(_) => section_items(child, out),
                _ => {}
            }
        }
    }
}

fn assert_section_items(base: &Value, gated: &Value, horizon: &str, suffix: &str) {
    let mut base_items = Vec::new();
    let mut items = Vec::new();
    section_items(base, &mut base_items);
    section_items(gated, &mut items);
    assert!(!base_items.is_empty(), "{suffix}: no items found");
    for item in &items {
        assert!(base_items.contains(item), "{suffix}: an item was rewritten: {item}");
    }
    let mut any_withheld = false;
    for item in &base_items {
        let mut dates = Vec::new();
        every_date(item, &mut dates);
        let shown = dates.iter().all(|date| before_horizon(date, horizon)) || chassis_only(item);
        assert_eq!(items.contains(item), shown, "{suffix}: {item}");
        any_withheld |= !shown;
    }
    assert_eq!(
        gated.get("marketClosureReasonLabel").and_then(Value::as_str),
        any_withheld.then_some(MARKET_CLOSURE),
        "{suffix}: the page says whether it withheld anything"
    );
    check_empty_reasons(base, gated, suffix);
}

fn check_empty_reasons(base: &Value, gated: &Value, suffix: &str) {
    let (Some(base), Some(gated)) = (base.as_object(), gated.as_object()) else {
        return;
    };
    for (key, reason) in gated.iter().filter(|(key, _)| key.ends_with("EmptyReason")) {
        let list = key.trim_end_matches("EmptyReason");
        let emptied = gated[list].as_array().is_some_and(Vec::is_empty)
            && base[list].as_array().is_some_and(|items| !items.is_empty());
        if emptied {
            assert_eq!(reason, LIST_CLOSED, "{suffix}: {key} claims the list is genuinely empty");
        }
    }
    for key in CONTAINER_LISTS {
        if let (Some(base_list), Some(gated_list)) =
            (base.get(key).and_then(Value::as_array), gated.get(key).and_then(Value::as_array))
        {
            for (base_element, gated_element) in base_list.iter().zip(gated_list) {
                check_empty_reasons(base_element, gated_element, suffix);
            }
        }
    }
}

fn slice_with_current_sessions(session_indices: &[usize]) -> CharacterSlice {
    let mut slice = one_character_slice();
    for &index in session_indices {
        slice.sessions[index - 1].mode_domain = ManifestModeDomain::Current;
    }
    slice
}

fn fixture_files(directory: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(directory)
        .unwrap_or_else(|error| panic!("{}: {error}", directory.display()))
        .map(|entry| entry.expect("directory entry").path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "json"))
        .collect();
    files.sort();
    files
}

fn kill_switch_ref(value: &Value) -> (String, u64) {
    let refs: Vec<&Value> = value["sourceRevisionSet"]
        .as_array()
        .expect("refs")
        .iter()
        .filter(|reference| reference["refKind"] == "projection_kill_switch")
        .collect();
    assert_eq!(refs.len(), 1, "exactly one kill-switch ref");
    (
        refs[0]["refId"].as_str().expect("id").to_owned(),
        refs[0]["revision"].as_u64().expect("revision"),
    )
}

// -- the set itself -----------------------------------------------------------

#[test]
fn loader_accepts_the_valid_corpus_and_rejects_every_negative_fixture() {
    let root = repo_root().join("contracts/projection-kill-switch/v1/fixtures");
    for path in fixture_files(&root.join("valid")) {
        let text = fs::read_to_string(&path).expect("read valid fixture");
        let set = ProjectionKillSwitch::parse(&text).unwrap_or_else(|error| panic!("{} rejected: {error}", path.display()));
        assert_eq!(set.origin, KillSwitchOrigin::Published);
    }
    let negative = fixture_files(&root.join("negative"));
    assert!(negative.len() >= 20);
    for path in &negative {
        let text = fs::read_to_string(path).expect("read negative fixture");
        assert!(ProjectionKillSwitch::parse(&text).is_err(), "{} was accepted", path.display());
        let (set, source) = ProjectionKillSwitch::load(path);
        assert_eq!(set, ProjectionKillSwitch::fail_closed());
        assert!(matches!(source, KillSwitchSource::FailClosed { .. }));
    }
}

/// The slice's set closes only the current-market projection, which the
/// slice has none of: what `pnpm slice:emit` writes is the baseline plus the
/// kill-switch provenance.
#[test]
fn the_slice_set_changes_nothing_but_provenance() {
    let (set, source) = ProjectionKillSwitch::load(&repo_root().join(SLICE_KILL_SWITCH_PATH));
    assert_eq!(source, KillSwitchSource::Published { revision: 1 });
    assert_eq!(
        ProjectionKillSwitch { origin: KillSwitchOrigin::ReleaseGateDefault, revision: 0, ..set.clone() },
        ProjectionKillSwitch::release_gate_default()
    );
    let slice = one_character_slice();
    let gated = public_api_documents_gated(&slice, &ProjectionFaults::default(), &set);
    assert_eq!(bodies(&parse(gated.clone())), bodies(&baseline()));
    for (relative, text) in &gated {
        let on_disk = fs::read_to_string(repo_root().join("fixtures/v5/one-character-slice/api").join(relative))
            .unwrap_or_else(|error| panic!("{relative}: {error}"));
        assert_eq!(&on_disk, text, "{relative} differs from the emitted fixture");
    }
}

/// N3. The canonical epoch is never mixed with the kill-switch revision;
/// the kill-switch coordinate (ref id + revision) is distinct for every set
/// a response can be projected under, so a cache keyed on the pair cannot
/// confuse two states (including fail-closed after a higher revision).
#[test]
fn epoch_stays_canonical_and_kill_switch_coordinates_are_distinct() {
    let slice = one_character_slice();
    let base = baseline();
    let mut fail_closed = ProjectionKillSwitch::fail_closed();
    fail_closed.revision = 0;
    let sets = [
        ProjectionKillSwitch::release_gate_default(),
        fail_closed,
        set_with(|set| set.revision = 1),
        set_with(|set| set.revision = 2),
    ];
    let mut coordinates = BTreeSet::new();
    for set in &sets {
        let documents = project(&slice, set);
        let mut seen = BTreeSet::new();
        for (path, value) in &documents {
            if path == "index.json" {
                continue;
            }
            assert_eq!(value["visibilityEpoch"], base[path]["visibilityEpoch"], "{path}: epoch is canonical");
            seen.insert(kill_switch_ref(value));
        }
        assert_eq!(seen.len(), 1, "every response of one projection carries the same coordinate");
        coordinates.extend(seen);
    }
    assert_eq!(coordinates.len(), sets.len(), "{coordinates:?}");
}

/// (a) A set that closed a historical fact, then got corrupted: the fact
/// does not come back -- fail-closed withdraws every market-derived object
/// from the first session on -- and the binary says so on stderr.
#[test]
fn a_corrupted_set_never_reopens_what_a_published_set_closed() {
    let scratch = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("projection-kill-switch");
    fs::create_dir_all(&scratch).expect("scratch dir");
    let path = scratch.join("closes-correction.json");
    let slice_set = fs::read_to_string(repo_root().join(SLICE_KILL_SWITCH_PATH)).expect("slice set");
    let published = slice_set
        .replace("\"revision\": 1", "\"revision\": 3")
        .replace("\"closedFactRevisionIds\": []", "\"closedFactRevisionIds\": [\"fact-hist-001-s07-correction\"]");
    fs::write(&path, &published).expect("write published set");
    let (set, source) = ProjectionKillSwitch::load(&path);
    assert_eq!(source, KillSwitchSource::Published { revision: 3 });
    let closed = project(&one_character_slice(), &set);
    assert!(!all_text(&closed).contains("fact-hist-001-s07-correction"));

    fs::write(&path, &published[..published.len() / 2]).expect("corrupt it");
    let (set, source) = ProjectionKillSwitch::load(&path);
    assert!(matches!(source, KillSwitchSource::FailClosed { .. }));
    let failed = project(&one_character_slice(), &set);
    let text = all_text(&failed);
    assert!(!text.contains("fact-hist-001-s07-correction") && !text.contains("更正公告"), "the closed fact came back");
    assert_horizon(&baseline(), &failed, "2026-03-02");
    assert_eq!(kill_switch_ref(doc(&failed, "v2/world.json")), ("projection-kill-switch/v1#fail-closed".to_owned(), 0));

    let out = scratch.join("fail-closed-api");
    let _ = fs::remove_dir_all(&out);
    let run = Command::new(env!("CARGO_BIN_EXE_panshi-character-episode"))
        .args(["--write-public-api"])
        .arg(&out)
        .arg(&path)
        .output()
        .expect("run the emitter");
    assert!(run.status.success(), "exit status stays 0 under fail-closed");
    let stderr = String::from_utf8_lossy(&run.stderr);
    assert!(stderr.contains("WARNING: kill switch FAIL-CLOSED"), "stderr: {stderr}");
    assert!(stderr.contains("every market-derived"), "stderr: {stderr}");
    let written: Value =
        serde_json::from_str(&fs::read_to_string(out.join("v2/world.json")).expect("written")).expect("json");
    assert_eq!(kill_switch_ref(&written), ("projection-kill-switch/v1#fail-closed".to_owned(), 0));
}

// -- one case per switch --------------------------------------------------------

#[test]
fn closing_one_fact_revision_withholds_from_its_first_appearance() {
    let gated = project(&one_character_slice(), &set_with(|set| {
        set.closed_fact_revision_ids.insert("fact-hist-001-s07-correction".to_owned());
    }));
    assert_horizon(&baseline(), &gated, "2026-03-10");
    let text = all_text(&gated);
    assert!(!text.contains("fact-hist-001-s07-correction") && !text.contains("更正公告"));
}

#[test]
fn closing_one_company_withholds_its_market_projection_only() {
    let other = project(&one_character_slice(), &set_with(|set| {
        set.closed_instruments.insert("OTHER-DEMO".to_owned());
    }));
    assert_eq!(bodies(&other), bodies(&baseline()));
    let gated = project(&one_character_slice(), &set_with(|set| {
        set.closed_instruments.insert("PSZS-DEMO".to_owned());
    }));
    assert_horizon(&baseline(), &gated, "2026-03-02");
    assert!(!all_text(&gated).contains("PSZS-DEMO"));
}

#[test]
fn closing_one_market_session_withholds_from_that_session() {
    let gated = project(&one_character_slice(), &set_with(|set| {
        set.closed_market_session_ids.insert("session-hist-001-s20".to_owned());
    }));
    assert_horizon(&baseline(), &gated, "2026-03-27");
}

#[test]
fn closing_one_story_act_removes_only_that_act() {
    let base = baseline();
    let world = doc(&base, "v2/world.json");
    let hook_id = world["storyHooks"][0]["hookId"].as_str().expect("hook id").to_owned();
    let gated = project(&one_character_slice(), &set_with(|set| {
        set.closed_story_act_ids.insert(hook_id.clone());
    }));
    let gated_world = doc(&gated, "v2/world.json");
    assert_eq!(gated_world["storyHooks"], json!([]));
    assert_eq!(gated_world["marketClosureReasonLabel"], MARKET_CLOSURE);
    assert_eq!(without(gated_world, &["storyHooks", "marketClosureReasonLabel"]), without(world, &["storyHooks"]));
    for (path, value) in &base {
        if !path.ends_with("v2/world.json") {
            assert_eq!(body(&gated[path]), body(value), "{path} changed when one act was closed");
        }
    }
}

#[test]
fn ticker_share_switch_has_no_slice_surface_and_changes_nothing() {
    let open = set_with(|set| set.ticker_specific_share_and_short_video = SwitchState::Open);
    assert!(open.ticker_share_and_short_video_open());
    assert!(!ProjectionKillSwitch::fail_closed().ticker_share_and_short_video_open());
    assert_eq!(bodies(&project(&one_character_slice(), &open)), bodies(&baseline()));
}

#[test]
fn closing_the_current_market_closes_only_current_mode_sessions() {
    let base = baseline();
    let closed = ProjectionKillSwitch::release_gate_default();
    assert_eq!(bodies(&project(&one_character_slice(), &closed)), bodies(&base));
    let mixed = slice_with_current_sessions(&[29]);
    assert_horizon(&base, &project(&mixed, &closed), "2026-04-13");
    assert_eq!(bodies(&project(&mixed, &open_current_market())), bodies(&base));
}

/// N2. The horizon is where the closed object first appears in the whole
/// world -- the session its `FactBecameVisible` was appended to -- not
/// where this character first touched it. The counter-evidence became
/// visible on 2026-03-02 (10:15, after that session's cutoff) and he first
/// missed it on 2026-03-03; the horizon is 2026-03-02.
#[test]
fn the_horizon_is_where_a_fact_first_appears_in_the_world() {
    let base = baseline();
    let slice = one_character_slice();
    let mut date = String::new();
    let mut visible: Vec<(String, String)> = Vec::new();
    for event in &slice.events {
        match event.event_type {
            "FactManifestAccepted" => {
                date = decode_canonical::<world::v1::FactManifestAcceptedV1>(&event.payload_bytes)
                    .expect("manifest")
                    .market_date_taipei;
            }
            "FactBecameVisible" => visible.push((
                decode_canonical::<world::v1::FactBecameVisibleV1>(&event.payload_bytes)
                    .expect("visible")
                    .fact_revision_id,
                date.clone(),
            )),
            _ => {}
        }
    }
    assert!(visible.iter().any(|(fact, date)| fact == "fact-hist-001-s01-counter-inventory" && date == "2026-03-02"));
    for (fact, date) in visible {
        let gated = project(&slice, &set_with(|set| {
            set.closed_fact_revision_ids.insert(fact.clone());
        }));
        assert_horizon(&base, &gated, &date);
    }
}

// -- inferring the withdrawn object from what is left ---------------------------

/// Point 1. Cash, stream versions and record shells.
#[test]
fn infer_hidden_trade_from_cash_or_versions_fails() {
    let base = baseline();
    let base_paper = doc(&base, "archive/paper.json");
    let cash = base_paper["account"]["cashMinorUnits"].as_i64().expect("cash");
    assert!(cash < base_paper["account"]["initialCapitalMinorUnits"].as_i64().expect("initial"));
    for set in [
        set_with(|set| {
            set.closed_paper_action_reveal_dates.insert("2026-03-17".to_owned());
        }),
        set_with(|set| {
            set.closed_instruments.insert("PSZS-DEMO".to_owned());
        }),
    ] {
        let gated = project(&one_character_slice(), &set);
        let text = all_text(&gated);
        for leak in ["cashMinorUnits", "paperVersionSet", "paperAccountVersion", "paper_account", "paper_position"] {
            assert!(!text.contains(leak), "{leak} is still public");
        }
        assert!(!text.contains(&cash.to_string()));
        for record in doc(&gated, "archive/paper.json")["historicalActionFills"].as_array().expect("records") {
            assert_eq!(record["recordDataState"], "READY", "{record}");
        }
    }
}

/// N1. The log position must not tell a trading day from a quiet one: under
/// a closed reveal the response reports the position the evening before,
/// so a viewer comparing it with yesterday's sees no advance -- 20 events
/// on 2026-03-17 (the reduction) and 12 on 2026-03-18 look the same.
#[test]
fn infer_trade_from_version_numbers_fails() {
    let slice = one_character_slice();
    let base = baseline();
    let full = doc(&base, "v2/world.json")["projectionVersion"].as_u64().expect("version");
    assert_ne!(events_before("2026-03-18") - events_before("2026-03-17"), events_before("2026-03-19") - events_before("2026-03-18"));
    for date in settled_dates() {
        let gated = project(&slice, &set_with(|set| {
            set.closed_paper_action_reveal_dates.insert(date.clone());
        }));
        for (path, value) in &gated {
            if path == "index.json" {
                continue;
            }
            assert_eq!(value["projectionVersion"], events_before(&date), "{path} under a closed {date}");
            assert_eq!(value["sourceGlobalPosition"], events_before(&date), "{path} under a closed {date}");
        }
        assert_ne!(events_before(&date), full, "a closed day never reports the whole log");
    }
}

/// Point 2. Neighbouring chapters, memories, habits, patterns.
#[test]
fn infer_hidden_reduction_from_adjacent_chapters_fails() {
    let gated = project(&one_character_slice(), &set_with(|set| {
        set.closed_paper_action_reveal_dates.insert("2026-03-17".to_owned());
    }));
    let text = all_text(&gated);
    for leak in ["600 股", "減碼", "4,720", "-472000"] {
        assert!(!text.contains(leak), "{leak} is still public");
    }
    let journal = doc(&gated, "life-journal.json");
    assert_eq!(journal["entries"].as_array().expect("entries").last().expect("a chapter")["chapterDate"], "2026-03-16");
}

/// Point 3. A sentence withheld anywhere is withheld everywhere.
#[test]
fn infer_hidden_sentence_from_another_page_fails() {
    let base = baseline();
    let blame = sentences_from("2026-03-27").into_iter().next().expect("the 03-27 sentence");
    assert!(all_text(&base).matches(&blame.0).count() > 1, "the baseline quotes it on several pages");
    let session = project(&one_character_slice(), &set_with(|set| {
        set.closed_market_session_ids.insert("session-hist-001-s20".to_owned());
    }));
    for (path, value) in &session {
        let text = value.to_string();
        assert!(!text.contains(&blame.0) && !text.contains(&blame.1), "{path} still quotes the withheld sentence");
    }
    let admission = sentences_from("2026-04-08").into_iter().next().expect("the 04-08 sentence");
    let company = project(&one_character_slice(), &set_with(|set| {
        set.closed_instruments.insert("PSZS-DEMO".to_owned());
    }));
    let close_up = doc(&company, "close-up.json");
    assert!(!close_up.to_string().contains(&admission.0));
    for key in ["unresolvedTensionSummary", "currentAttention", "currentVerbPhrase", "publicClaim"] {
        assert!(close_up.get(key).is_none(), "close-up {key} still points at the withheld loss");
    }
}

/// N4 and point 4. With every session current-mode and the current market
/// closed (the release-gate default), the character world keeps running:
/// his everyday interactions with her, the memories he arrived with, the
/// natal motif's readings (on the chart page and on each held chapter),
/// identity and chassis are all readable -- and none of them carries a
/// string or id from which withheld market content can be recovered.
#[test]
fn infer_market_from_the_surviving_life_relations_and_memories_fails() {
    let base = baseline();
    let all: Vec<usize> = (1..=30).collect();
    let gated = project(&slice_with_current_sessions(&all), &ProjectionKillSwitch::release_gate_default());
    assert_horizon(&base, &gated, "2026-03-02");

    // What survives.
    let relations = doc(&gated, "archive/relations.json");
    let interactions = relations["acquaintances"][0]["observedInteractions"].as_array().expect("interactions");
    let base_interactions = doc(&base, "archive/relations.json")["acquaintances"][0]["observedInteractions"]
        .as_array()
        .expect("interactions")
        .clone();
    let everyday: Vec<&Value> = base_interactions.iter().filter(|item| chassis_only(item)).collect();
    assert_eq!(everyday.len(), 3, "three everyday interactions; two are about the position");
    assert_eq!(interactions.iter().collect::<Vec<_>>(), everyday);
    let memories = doc(&gated, "archive/memories.json")["memories"].as_array().expect("memories").clone();
    assert_eq!(memories.len(), 3, "the three memories he arrived with");
    let invocations = doc(&gated, "archive/chart.json")["motifs"][0]["invocations"].as_array().expect("readings").clone();
    assert_eq!(invocations, doc(&base, "archive/chart.json")["motifs"][0]["invocations"].as_array().expect("readings").clone());
    assert!(!invocations.is_empty());
    let held_segments: Vec<Value> = doc(&gated, "life-journal.json")["heldEntries"]
        .as_array()
        .expect("held")
        .iter()
        .filter_map(|held| held.get("nonMarketSegments").cloned())
        .collect();
    assert_eq!(held_segments.len(), invocations.len(), "each held chapter with a reading keeps it");
    for key in ["identity", "milestones", "originMemories", "unrecordedFacets", "joinedWorldOn"] {
        assert_eq!(doc(&gated, "archive/life.json")[key], doc(&base, "archive/life.json")[key], "life {key}");
    }
    for key in ["fourAxis", "coreNeed", "coreFear", "bloodType", "selfDescription"] {
        assert_eq!(doc(&gated, "archive/traits.json")[key], doc(&base, "archive/traits.json")[key], "traits {key}");
    }

    // What they must not carry.
    let survivors = serde_json::to_string(&json!([interactions, memories, invocations, held_segments])).expect("json");
    let base_paper = doc(&base, "archive/paper.json");
    let mut leaks: Vec<String> = vec![
        "fact-hist".to_owned(),
        "PSZS-DEMO".to_owned(),
        "部位".to_owned(),
        "減碼".to_owned(),
        "虧損".to_owned(),
        "股".to_owned(),
        base_paper["positions"][0]["positionId"].as_str().expect("position").to_owned(),
        base_paper["paperVersionSet"]["paperAccountRef"].as_str().expect("account").to_owned(),
    ];
    for (id, sentence) in sentences_from("2026-03-02") {
        leaks.push(id);
        leaks.push(sentence);
    }
    for leak in &leaks {
        assert!(!survivors.contains(leak.as_str()), "a surviving life item carries {leak}");
    }
    let mut positions = Vec::new();
    global_positions(&json!([interactions, memories, invocations, held_segments]), &mut positions);
    assert!(positions.iter().all(|&position| position <= events_before("2026-03-02")), "{positions:?}");
    let text = all_text(&gated);
    for leak in ["建立了紙上部位", "減碼", "過了自己寫的期限仍然持有", "cashMinorUnits", "PSZS-DEMO"] {
        assert!(!text.contains(leak), "{leak} is still public");
    }
}

/// Point 5. Closing a day's reveal is not an oracle for whether he traded.
#[test]
fn infer_whether_a_day_traded_from_the_reveal_switch_fails() {
    let base = baseline();
    let slice = one_character_slice();
    for date in settled_dates() {
        let session_id = slice
            .sessions
            .iter()
            .find(|session| session.market_date_taipei == date)
            .expect("session")
            .market_session_id;
        let reveal = project(&slice, &set_with(|set| {
            set.closed_paper_action_reveal_dates.insert(date.clone());
        }));
        let session = project(&slice, &set_with(|set| {
            set.closed_market_session_ids.insert(session_id.to_owned());
        }));
        assert_eq!(reveal, session, "{date}: reveal and session closures differ");
        assert_horizon(&base, &reveal, &date);
    }
    let shape = |date: &str| {
        let gated = project(&slice, &set_with(|set| {
            set.closed_paper_action_reveal_dates.insert(date.to_owned());
        }));
        let paper = doc(&gated, "archive/paper.json").as_object().expect("paper").keys().cloned().collect::<Vec<_>>();
        let close_up = doc(&gated, "close-up.json").as_object().expect("close-up").keys().cloned().collect::<Vec<_>>();
        (paper, close_up)
    };
    assert_eq!(shape("2026-03-17"), shape("2026-03-18"), "a trading and a quiet day look alike");
    assert_eq!(shape("2026-03-03"), shape("2026-03-04"));
}
