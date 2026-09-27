//! Every visible claim in the one-character slice's public projection
//! carries its own truth class (`contracts/openapi/public-v2.yaml` 2.1.0,
//! with the nested-item gaps closed in 2.2.0), every fixed system sentence
//! is one the contract lists, and nothing is `real_fact`.
//!
//! Two independent checks, because each one alone has a blind spot:
//!
//! 1. **Named fields.** The claim fields a review found without a per-item
//!    class (life-journal summaries, paper rationale and revision notes,
//!    the close-up's claims, the archive index's summaries, the world's
//!    labels; since 2.2.0 also the people a memory involves, the
//!    counterpart and the quoted sentence on a relationship signal, the
//!    lots and the fill) are listed here by path, and each one must have
//!    its own class where the contract puts it, with the class that claim
//!    is. This is the contract, stated as a test.
//! 2. **Nothing readable left over.** A walker visits every value in every
//!    document and requires each human-readable string (any string
//!    containing a CJK character), each claim-shaped state, and **every
//!    number** to be covered by a class **on the same object**: a sibling
//!    `<key>TruthClass`, or the object's own `truthClass` -- or, for a list
//!    of strings, a parallel `<singular>TruthClasses`. Nothing inherits a
//!    class from an object further up (2.2.0), and for every schema
//!    `contracts/openapi/public-v2-system-labels.json`'s
//!    `requiredSiblingTruthClasses.schemas` lists -- not only
//!    `RelationshipSignalView` (`archive/relations.json`'s
//!    `relationshipSignals[]`, `life-journal.json`'s per-entry
//!    `relationshipConsequence`), but also `CharacterCloseUp`,
//!    `PaperPositionPublic`, `PaperDailyActionDisclosure`,
//!    `LifeJournalEntry` and the rest -- the properties it names cannot
//!    inherit the object's own class either, sideways: `SiblingContract`
//!    (built from that same JSON plus the schema shapes `public-v2.yaml`
//!    declares, the way `tools/v5-slice-api-audit.mjs` reads them) tells
//!    `covered_here` which schema an object is and, for a pinned property
//!    such as `RelationshipSignalView.displayName` (`fictional_setting`,
//!    distinct from the signal's own `simulated_narrative`), requires the
//!    sibling to hold exactly that value rather than accepting the
//!    object's `truthClass` as a stand-in. The only other ways through are
//!    the two lists in `contracts/openapi/public-v2-system-labels.json`:
//!    a field marked `x-panshi-system-label` must hold one of that field's
//!    listed sentences (a system label is not a claim and carries no
//!    class), and a number whose key is listed in `nonClaimNumberKeys`
//!    (provenance, versioning, scene layout) needs none. A new prose field,
//!    figure or label added without a class or a listing fails here even
//!    if nobody names it in (1).
//!
//! The walker runs over the default projection, over a fault-injected one
//! (narrative failed on some chapters, one chapter held), because those
//! paths emit different shapes, and over the eleven emitted fixture files
//! on disk, because those are what the web client and the audits read.

use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::PathBuf,
};

use panshi_character_episode::{
    public_api::{ProjectionFaults, public_api_documents_with},
    slice::one_character_slice,
};
use serde_json::{Map, Value};

/// The classes a repo-local synthetic fixture may claim.
const ALLOWED: [&str; 3] = [
    "fictional_setting",
    "symbolic_interpretation",
    "simulated_narrative",
];

/// Claim-shaped keys whose values are not prose (enums, ASCII labels,
/// integers) but still say something about him or his paper book.
const CLAIM_KEYS: [&str; 12] = [
    "displayName",
    "ageYears",
    "occupationLabel",
    "poseState",
    "instrumentLabel",
    "status",
    "invalidationCondition",
    "action",
    "direction",
    "heldDays",
    "confidencePercentFixed2",
    "label",
];

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// `contracts/openapi/public-v2-system-labels.json`: field -> the fixed
/// sentences it may hold, and the numeric keys that are not claims.
struct Allowlist {
    labels: BTreeMap<String, BTreeSet<String>>,
    non_claim_numbers: BTreeSet<String>,
}

fn allowlist() -> Allowlist {
    let path = repo_root().join("contracts/openapi/public-v2-system-labels.json");
    let text =
        fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    let value: Value = serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("{} is not valid JSON: {error}", path.display()));
    let labels = value["systemLabels"]
        .as_object()
        .expect("systemLabels is an object")
        .iter()
        .map(|(field, texts)| {
            let texts = texts
                .as_array()
                .unwrap_or_else(|| panic!("systemLabels.{field} is not a list"))
                .iter()
                .map(|text| {
                    text.as_str()
                        .expect("a system label is a string")
                        .to_owned()
                })
                .collect();
            (field.clone(), texts)
        })
        .collect();
    let non_claim_numbers = value["nonClaimNumberKeys"]
        .as_object()
        .expect("nonClaimNumberKeys is an object")
        .keys()
        .cloned()
        .collect();
    Allowlist {
        labels,
        non_claim_numbers,
    }
}

fn faulted() -> ProjectionFaults {
    ProjectionFaults {
        narrative_failed_chapters: [2, 4].into_iter().collect(),
        held_chapters: [3].into_iter().collect(),
    }
}

/// The ten response documents of one projection, parsed; `index.json` is a
/// route table with no claims and is walked only on disk.
fn documents(faults: &ProjectionFaults) -> Vec<(String, Value)> {
    public_api_documents_with(&one_character_slice(), faults)
        .into_iter()
        .filter(|(path, _)| path != "index.json")
        .map(|(path, text)| {
            let value = serde_json::from_str(&text)
                .unwrap_or_else(|error| panic!("{path} is not valid JSON: {error}"));
            (path, value)
        })
        .collect()
}

/// The eleven emitted fixture files on disk (`pnpm slice:emit`).
fn fixture_files() -> Vec<(String, Value)> {
    let root = repo_root().join("fixtures/v5/one-character-slice/api");
    let mut out = Vec::new();
    let mut pending = vec![root.clone()];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(&directory)
            .unwrap_or_else(|error| panic!("{}: {error}", directory.display()))
        {
            let path = entry.expect("directory entry").path();
            if path.is_dir() {
                pending.push(path);
            } else if path
                .extension()
                .is_some_and(|extension| extension == "json")
            {
                let text = fs::read_to_string(&path)
                    .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
                let value = serde_json::from_str(&text).unwrap_or_else(|error| {
                    panic!("{} is not valid JSON: {error}", path.display())
                });
                let relative = path
                    .strip_prefix(&root)
                    .expect("under the fixture root")
                    .display()
                    .to_string();
                out.push((relative, value));
            }
        }
    }
    out.sort_by(|left, right| left.0.cmp(&right.0));
    out
}

fn is_system_label(key: &str) -> bool {
    key.ends_with("EmptyReason")
        || key.ends_with("NullReason")
        || key == "heldReasonLabel"
        || key == "tombstoneReasonLabel"
}

fn has_cjk(text: &str) -> bool {
    text.chars().any(|character| {
        matches!(u32::from(character), 0x3000..=0x303f | 0x3400..=0x4dbf | 0x4e00..=0x9fff | 0xff00..=0xffef)
    })
}

/// A truth-class value: a string in `ALLOWED` and declared by the envelope
/// (when the document has one).
fn assert_class(where_: &str, value: &Value, declared: Option<&BTreeSet<String>>) -> String {
    let class = value
        .as_str()
        .unwrap_or_else(|| panic!("{where_}: truth class is not a string: {value}"));
    assert!(
        ALLOWED.contains(&class),
        "{where_}: truth class {class} may not appear in a synthetic slice"
    );
    if let Some(declared) = declared {
        assert!(
            declared.contains(class),
            "{where_}: truth class {class} is not declared by the envelope"
        );
    }
    class.to_owned()
}

/// `contracts/openapi/public-v2.yaml`'s `components.schemas.<Name>.properties.<prop>`
/// names, by schema. A line reader mirroring `schemaPropertiesFromContract`
/// in `tools/v5-slice-api-audit.mjs`: it relies on the contract's fixed
/// two-space layout (schema names at 4 spaces, `properties:` at 6, property
/// names at 8). Properties of inline nested objects (deeper) are not
/// collected. If the layout changes, the caller's own floor check fails
/// closed rather than this silently finding nothing.
fn schema_properties_from_contract(yaml: &str) -> BTreeMap<String, BTreeSet<String>> {
    /// A line with exactly `indent` leading spaces, then an
    /// `[A-Za-z0-9_]+` key, then `:` -- the rest of the line after the
    /// colon is returned but not required to be empty.
    fn key_at_indent(line: &str, indent: usize) -> Option<(&str, &str)> {
        let bytes = line.as_bytes();
        if line.len() <= indent || bytes[..indent].iter().any(|&byte| byte != b' ') {
            return None;
        }
        if bytes.get(indent) == Some(&b' ') {
            return None;
        }
        let rest = &line[indent..];
        let end = rest
            .find(|character: char| !(character.is_ascii_alphanumeric() || character == '_'))
            .unwrap_or(rest.len());
        if end == 0 {
            return None;
        }
        let (key, after) = rest.split_at(end);
        after.strip_prefix(':').map(|remainder| (key, remainder))
    }

    let mut schemas: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut in_schemas = false;
    let mut schema: Option<String> = None;
    let mut block: Option<String> = None;
    for line in yaml.lines() {
        if line == "  schemas:" {
            in_schemas = true;
            continue;
        }
        if in_schemas {
            let indent = line.len() - line.trim_start().len();
            if !line.trim().is_empty() && indent <= 3 {
                in_schemas = false;
            }
        }
        if !in_schemas {
            continue;
        }
        if let Some((name, after)) = key_at_indent(line, 4)
            && after.trim().is_empty()
        {
            schema = Some(name.to_owned());
            schemas.entry(name.to_owned()).or_default();
            block = None;
            continue;
        }
        if let Some((name, _)) = key_at_indent(line, 6) {
            block = Some(name.to_owned());
            continue;
        }
        if block.as_deref() == Some("properties")
            && let Some((name, _)) = key_at_indent(line, 8)
            && let Some(schema) = &schema
        {
            schemas.entry(schema.clone()).or_default().insert(name.to_owned());
        }
    }
    schemas
}

/// `prop -> schema`, for every property that exactly one schema in
/// `schemas` declares. An object carrying that property as one of its own
/// keys is thereby known to be (at least) an instance of that schema --
/// the same rule `tools/v5-slice-api-audit.mjs` uses to tell a
/// `RelationshipSignalView` from a `CharacterCloseUp` from a
/// `PaperPositionPublic` without a `$schema` tag on the wire.
fn identifying_properties(schemas: &BTreeMap<String, BTreeSet<String>>) -> BTreeMap<String, String> {
    let mut owners: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for (schema, props) in schemas {
        for prop in props {
            owners.entry(prop.as_str()).or_default().push(schema.as_str());
        }
    }
    owners
        .into_iter()
        .filter_map(|(prop, owning)| (owning.len() == 1).then(|| (prop.to_owned(), owning[0].to_owned())))
        .collect()
}

/// `requiredSiblingTruthClasses.schemas` from
/// `contracts/openapi/public-v2-system-labels.json`, the same map
/// `tools/v5-slice-api-audit.mjs` reads: schema -> field -> the truth class
/// its sibling `<field>TruthClass` must equal (`None` when the contract lets
/// the class vary with the source but the sibling is still mandatory).
fn required_sibling_schemas(
    repo_root: &std::path::Path,
) -> BTreeMap<String, BTreeMap<String, Option<String>>> {
    let path = repo_root.join("contracts/openapi/public-v2-system-labels.json");
    let text =
        fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    let value: Value = serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("{} is not valid JSON: {error}", path.display()));
    value["requiredSiblingTruthClasses"]["schemas"]
        .as_object()
        .unwrap_or_else(|| panic!("{}: requiredSiblingTruthClasses.schemas is not an object", path.display()))
        .iter()
        .map(|(schema, fields)| {
            let fields = fields
                .as_object()
                .unwrap_or_else(|| panic!("{}: requiredSiblingTruthClasses.schemas.{schema} is not an object", path.display()))
                .iter()
                .map(|(key, class)| {
                    let pinned = match class {
                        Value::Null => None,
                        Value::String(text) => Some(text.clone()),
                        other => panic!(
                            "{}: requiredSiblingTruthClasses.schemas.{schema}.{key} must be a class name or null, found {other}",
                            path.display()
                        ),
                    };
                    (key.clone(), pinned)
                })
                .collect();
            (schema.clone(), fields)
        })
        .collect()
}

/// The shared identity/sibling contract this walker and
/// `tools/v5-slice-api-audit.mjs` both read: which schema an object is (by
/// its own unique properties, from `public-v2.yaml`), and which of that
/// schema's properties may never fall back to the object's own `truthClass`
/// for their class (from `public-v2-system-labels.json`'s
/// `requiredSiblingTruthClasses`). Loaded once per walk rather than
/// hardcoded to one shape (`RelationshipSignalView`): a schema newly listed
/// there -- `CharacterCloseUp`, `PaperPositionPublic`,
/// `PaperDailyActionDisclosure`, `LifeJournalEntry` and the rest -- is
/// covered by construction, with no further change to this walker.
struct SiblingContract {
    identifying_property: BTreeMap<String, String>,
    by_schema: BTreeMap<String, BTreeMap<String, Option<String>>>,
}

impl SiblingContract {
    fn load() -> Self {
        let root = repo_root();
        let yaml_path = root.join("contracts/openapi/public-v2.yaml");
        let yaml = fs::read_to_string(&yaml_path)
            .unwrap_or_else(|error| panic!("{}: {error}", yaml_path.display()));
        let schemas = schema_properties_from_contract(&yaml);
        assert!(
            schemas.len() >= 50,
            "only {} schemas parsed from {}",
            schemas.len(),
            yaml_path.display()
        );
        let by_schema = required_sibling_schemas(&root);
        assert!(!by_schema.is_empty(), "requiredSiblingTruthClasses.schemas is empty");
        Self {
            identifying_property: identifying_properties(&schemas),
            by_schema,
        }
    }

    /// Whether, and how, `key` must carry its own sibling `<key>TruthClass`
    /// when `object` matches (by an identifying property among its own
    /// keys) a schema that `requiredSiblingTruthClasses` lists for `key`.
    /// `None`: no matched schema declares a rule for `key`, so the generic
    /// fallback in `covered_here` applies instead.
    fn required_pin<'a>(&'a self, object: &Map<String, Value>, key: &str) -> Option<SiblingPin<'a>> {
        object
            .keys()
            .filter_map(|k| self.identifying_property.get(k))
            .find_map(|schema| self.by_schema.get(schema)?.get(key))
            .map(|pinned| match pinned {
                Some(class) => SiblingPin::Fixed(class),
                None => SiblingPin::Any,
            })
    }
}

/// Whether a required sibling `<key>TruthClass` must equal one exact class,
/// or may hold any class the slice otherwise allows -- `requiredSiblingTruthClasses`'s
/// `null` vs. a pinned string, resolved against the schema `object` matches.
enum SiblingPin<'a> {
    /// The sibling is mandatory, and must equal exactly this class.
    Fixed(&'a str),
    /// The sibling is mandatory, but any legal class satisfies it.
    Any,
}

/// Whether `key` on `object` is covered by a class on the same object.
///
/// For a key `siblings` requires its own sibling for, on a schema `object`
/// is recognised as (2.2.0, generic over every schema
/// `requiredSiblingTruthClasses` lists, not only `RelationshipSignalView`):
/// covered only by the sibling `<key>TruthClass`, and, when the contract
/// pins a class, only when it equals exactly that class -- never by the
/// object's own `truthClass`, and never by a sibling holding some other
/// (even otherwise-legal) class. This is what keeps a deleted
/// `instrumentLabelTruthClass` on a `PaperPositionPublic`, or a
/// `displayNameTruthClass` mis-set to the object's own class on a
/// `CharacterCloseUp`, from silently reading as covered.
///
/// For every other key and shape -- including `ArchivePersonLabel`,
/// `ArchiveAcquaintance`, `InfluenceRef` and `LifeIdentity`, whose bare
/// `displayName`/`relationLabel` have no sibling by design, per their own
/// schema descriptions -- the fallback is as before: its own sibling first,
/// then the object's `truthClass`. Never an ancestor's.
fn covered_here(object: &Map<String, Value>, key: &str, siblings: &SiblingContract) -> bool {
    let sibling_key = format!("{key}TruthClass");
    if let Some(pin) = siblings.required_pin(object, key) {
        let value = object.get(&sibling_key).and_then(Value::as_str);
        return match pin {
            SiblingPin::Fixed(class) => value == Some(class),
            SiblingPin::Any => value.is_some(),
        };
    }
    object
        .get(&sibling_key)
        .or_else(|| object.get("truthClass"))
        .is_some_and(|class| !class.is_null())
}

#[derive(Default)]
struct Walk {
    claims: usize,
    numbers: usize,
    classes_seen: usize,
    system_labels: usize,
    non_claim_numbers: usize,
    uncovered: Vec<String>,
}

fn walk(
    path: &str,
    value: &Value,
    declared: Option<&BTreeSet<String>>,
    allow: &Allowlist,
    siblings: &SiblingContract,
    out: &mut Walk,
) {
    match value {
        Value::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                walk(&format!("{path}[{index}]"), item, declared, allow, siblings, out);
            }
        }
        Value::Object(object) => {
            for (key, child) in object {
                let here = format!("{path}.{key}");
                // Every class value anywhere must be a legal, declared one.
                if key == "truthClass" || key.ends_with("TruthClass") {
                    if !child.is_null() {
                        assert_class(&here, child, declared);
                        out.classes_seen += 1;
                    }
                    continue;
                }
                if key.ends_with("TruthClasses") {
                    for (index, class) in child.as_array().into_iter().flatten().enumerate() {
                        assert_class(&format!("{here}[{index}]"), class, declared);
                        out.classes_seen += 1;
                    }
                    continue;
                }
                // A system label: no class, but only a listed sentence.
                if is_system_label(key) {
                    match (allow.labels.get(key), child) {
                        (_, Value::Null) => {}
                        (Some(texts), Value::String(text)) if texts.contains(text) => {
                            out.system_labels += 1;
                        }
                        (None, _) => out.uncovered.push(format!(
                            "{here} = {child} (system-label field not listed in the contract)"
                        )),
                        (Some(_), _) => out
                            .uncovered
                            .push(format!("{here} = {child} (not a listed system label)")),
                    }
                    continue;
                }
                let own = covered_here(object, key, siblings);
                match child {
                    Value::String(text) => {
                        if has_cjk(text) || CLAIM_KEYS.contains(&key.as_str()) {
                            out.claims += 1;
                            if !own {
                                out.uncovered.push(format!("{here} = {text:?}"));
                            }
                        }
                    }
                    Value::Number(_) => {
                        out.numbers += 1;
                        if allow.non_claim_numbers.contains(key) {
                            out.non_claim_numbers += 1;
                        } else {
                            out.claims += 1;
                            if !own {
                                out.uncovered.push(format!("{here} = {child} (number)"));
                            }
                        }
                    }
                    Value::Array(items)
                        if items.iter().all(Value::is_string) && !items.is_empty() =>
                    {
                        // A list of strings is labelled index for index by a
                        // parallel `<singular>TruthClasses`.
                        let readable = items.iter().any(|item| item.as_str().is_some_and(has_cjk));
                        if readable {
                            let singular = key.strip_suffix('s').unwrap_or(key);
                            let parallel = object
                                .get(&format!("{singular}TruthClasses"))
                                .and_then(Value::as_array);
                            for (index, item) in items.iter().enumerate() {
                                out.claims += 1;
                                if parallel.and_then(|classes| classes.get(index)).is_none() {
                                    out.uncovered.push(format!("{here}[{index}] = {item}"));
                                }
                            }
                        }
                    }
                    // A nested object or list is walked on its own terms:
                    // it passes no class down (2.2.0).
                    _ => walk(&here, child, declared, allow, siblings, out),
                }
            }
        }
        _ => {}
    }
}

fn declared_classes(document: &Value) -> Option<BTreeSet<String>> {
    document.get("truthClasses").map(|classes| {
        classes
            .as_array()
            .expect("envelope truthClasses is a list")
            .iter()
            .map(|class| {
                class
                    .as_str()
                    .expect("envelope class is a string")
                    .to_owned()
            })
            .collect()
    })
}

fn walk_documents(documents: &[(String, Value)]) -> Walk {
    let allow = allowlist();
    let siblings = SiblingContract::load();
    let mut out = Walk::default();
    for (path, document) in documents {
        let declared = declared_classes(document);
        walk(path, document, declared.as_ref(), &allow, &siblings, &mut out);
    }
    out
}

fn walk_all(faults: &ProjectionFaults) -> Walk {
    walk_documents(&documents(faults))
}

fn assert_nothing_uncovered(walk: &Walk) {
    assert!(
        walk.uncovered.is_empty(),
        "{} visible values are neither classified on their own object nor listed as system labels / non-claim numbers:\n{}",
        walk.uncovered.len(),
        walk.uncovered.join("\n")
    );
}

/// The eleven emitted JSON files on disk: every CJK string and every number
/// is classified on its own object or listed in the contract allowlist.
/// Zero exceptions.
#[test]
fn emitted_fixture_files_have_no_unclassified_text_or_number() {
    let files = fixture_files();
    assert_eq!(
        files.len(),
        11,
        "expected the ten response documents plus index.json, found {:?}",
        files.iter().map(|(path, _)| path).collect::<Vec<_>>()
    );
    let walk = walk_documents(&files);
    assert_nothing_uncovered(&walk);
    // Not a vacuous pass: the files carry hundreds of claims and numbers,
    // and the three reasons a review found unlabelled (28 + 1 + 1) plus the
    // other empty-list reasons are all visited as system labels.
    assert!(walk.claims >= 400, "only {} claims visited", walk.claims);
    assert!(walk.numbers >= 400, "only {} numbers visited", walk.numbers);
    assert!(
        walk.system_labels >= 30,
        "only {} system labels visited",
        walk.system_labels
    );
    assert!(walk.non_claim_numbers > 0);
}

/// No readable claim anywhere without a class, default projection.
#[test]
fn every_visible_claim_is_covered_by_its_own_truth_class() {
    let walk = walk_all(&ProjectionFaults::default());
    assert_nothing_uncovered(&walk);
    // Not a vacuous pass: the slice carries hundreds of claims, and a class
    // for each.
    assert!(walk.claims >= 400, "only {} claims visited", walk.claims);
    assert!(
        walk.classes_seen >= 400,
        "only {} classes visited",
        walk.classes_seen
    );
}

/// Same, on the degraded shapes: evidence-card-only chapters and a held one.
#[test]
fn every_visible_claim_is_covered_when_chapters_degrade() {
    let walk = walk_all(&faulted());
    assert_nothing_uncovered(&walk);
    assert!(walk.claims >= 400, "only {} claims visited", walk.claims);
    // The held chapter's label is a listed system label too.
    assert!(
        walk.system_labels >= 30,
        "only {} system labels visited",
        walk.system_labels
    );
}

fn document<'a>(documents: &'a [(String, Value)], suffix: &str) -> &'a Value {
    documents
        .iter()
        .find(|(path, _)| path.ends_with(suffix))
        .map_or_else(
            || panic!("no document ending in {suffix}"),
            |(_, value)| value,
        )
}

fn sibling(where_: &str, object: &Value, field: &str) -> String {
    let key = format!("{field}TruthClass");
    assert!(
        object.get(field).is_some(),
        "{where_}: the claim field {field} itself is missing"
    );
    object
        .get(&key)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("{where_}: {field} has no {key}"))
        .to_owned()
}

fn own(where_: &str, object: &Value) -> String {
    object
        .get("truthClass")
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("{where_}: no truthClass on {object}"))
        .to_owned()
}

/// The named claim fields each carry their class where the contract says,
/// and each class is the one that claim is. One flat walk over the ten
/// documents reads better than ten helpers, hence the length.
#[allow(clippy::too_many_lines)]
#[test]
fn named_claim_fields_carry_the_contract_truth_class() {
    for faults in [ProjectionFaults::default(), faulted()] {
        let documents = documents(&faults);

        let world = document(&documents, "v2/world.json");
        for (index, position) in world["characterPositions"]
            .as_array()
            .expect("positions")
            .iter()
            .enumerate()
        {
            let at = format!("world.characterPositions[{index}]");
            assert_eq!(sibling(&at, position, "poseState"), "simulated_narrative");
            assert_eq!(
                position["focusHintTruthClass"].is_null(),
                position["focusHint"].is_null(),
                "{at}: focusHintTruthClass must be non-null exactly when focusHint is"
            );
        }
        for (index, hook) in world["storyHooks"]
            .as_array()
            .expect("hooks")
            .iter()
            .enumerate()
        {
            assert_eq!(
                sibling(&format!("world.storyHooks[{index}]"), hook, "label"),
                "simulated_narrative"
            );
        }

        let close_up = document(&documents, "close-up.json");
        for field in ["displayName", "ageYears", "occupationLabel"] {
            assert_eq!(sibling("close-up", close_up, field), "fictional_setting");
        }
        for field in ["poseState", "currentVerbPhrase", "unresolvedTensionSummary"] {
            assert_eq!(sibling("close-up", close_up, field), "simulated_narrative");
        }
        for field in [
            "currentAttention",
            "publicClaim",
            "selfAcknowledgement",
            "recentConsequenceHighlight",
        ] {
            assert_eq!(
                own(&format!("close-up.{field}"), &close_up[field]),
                "simulated_narrative"
            );
        }
        for commitment in close_up["unresolvedCommitments"]
            .as_array()
            .expect("commitments")
        {
            assert_eq!(
                own("close-up.unresolvedCommitments[]", commitment),
                "simulated_narrative"
            );
        }

        let journal = document(&documents, "life-journal.json");
        let entries = journal["entries"].as_array().expect("entries");
        assert!(!entries.is_empty());
        for entry in entries {
            let at = format!("life-journal {}", entry["chapterDate"]);
            for field in [
                "sceneSummary",
                "knownAtTheTimeSummary",
                "actionSummary",
                "openQuestionSummary",
            ] {
                assert_eq!(
                    sibling(&at, entry, field),
                    "simulated_narrative",
                    "{at}: {field}"
                );
            }
            // Optional claims: the class is present exactly when the claim is.
            for (field, class_key) in [
                ("missedFactsSummary", "missedFactsSummaryTruthClass"),
                ("recurringPatternRef", "recurringPatternTruthClass"),
            ] {
                assert_eq!(
                    entry.get(field).is_some(),
                    entry.get(class_key).is_some(),
                    "{at}: {class_key} must be present exactly when {field} is"
                );
            }
            if let Some(claim) = entry.get("contemporaneousClaim") {
                assert_eq!(own(&at, claim), "simulated_narrative");
            }
            assert_eq!(
                own(&at, &entry["currentSelfNarration"]),
                "simulated_narrative"
            );
            if let Some(signal) = entry
                .get("relationshipConsequence")
                .filter(|signal| !signal.is_null())
            {
                assert_signal_view(&format!("{at}.relationshipConsequence"), signal);
            }
            let consequence = &entry["consequence"];
            if let Some(paper) = consequence.get("paperConsequence") {
                assert_eq!(own(&at, paper), "simulated_narrative");
            }
            if consequence.get("nonPaperConsequenceSummary").is_some() {
                assert_eq!(
                    sibling(&at, consequence, "nonPaperConsequenceSummary"),
                    "simulated_narrative"
                );
            }
        }

        let index = document(&documents, "/archive.json");
        assert_eq!(
            sibling("archive", index, "longTermTensionSummary"),
            "simulated_narrative"
        );
        let highlights = index["recentHighlights"].as_array().expect("highlights");
        let highlight_classes = index["recentHighlightTruthClasses"]
            .as_array()
            .expect("highlight classes");
        assert!(!highlights.is_empty());
        assert_eq!(
            highlights.len(),
            highlight_classes.len(),
            "one class per highlight"
        );
        for section in index["sections"].as_array().expect("sections") {
            let key = section["sectionKey"].as_str().expect("section key");
            let expected = match key {
                "chart" => "symbolic_interpretation",
                "traits" => "fictional_setting",
                _ => "simulated_narrative",
            };
            assert_eq!(
                sibling(&format!("archive.sections.{key}"), section, "summary"),
                expected
            );
        }

        let paper = document(&documents, "archive/paper.json");
        assert_eq!(
            own("paper.account", &paper["account"]),
            "simulated_narrative"
        );
        let positions = paper["positions"].as_array().expect("positions");
        assert!(!positions.is_empty());
        for position in positions {
            assert_eq!(own("paper.position", position), "simulated_narrative");
            assert_eq!(
                sibling("paper.position", position, "instrumentLabel"),
                "fictional_setting"
            );
            for field in ["rationaleSummary", "consequenceSummary"] {
                assert_eq!(
                    sibling("paper.position", position, field),
                    "simulated_narrative"
                );
            }
            for field in ["concurrentClaim", "currentNarration"] {
                assert_eq!(
                    own(&format!("paper.position.{field}"), &position[field]),
                    "simulated_narrative"
                );
            }
            // 2.2.0: each lot's figures carry their own class, the same one
            // as the position's figures on this page.
            let lots = position["lots"].as_array().expect("lots");
            assert!(!lots.is_empty(), "the open position has a lot");
            for lot in lots {
                assert!(lot["costBasisMinorUnits"].is_i64());
                assert_eq!(
                    own("paper.position.lots[]", lot),
                    own("paper.position", position)
                );
            }
        }
        let mut disclosed = 0;
        let mut filled = 0;
        for record in paper["historicalActionFills"].as_array().expect("records") {
            let Some(disclosure) = record.get("dailyActionDisclosure") else {
                continue;
            };
            disclosed += 1;
            let at = format!("paper.historicalActionFills {}", record["tradingDate"]);
            assert_eq!(own(&at, disclosure), "simulated_narrative");
            assert_eq!(
                sibling(&at, disclosure, "instrumentLabel"),
                "fictional_setting"
            );
            assert_eq!(
                sibling(&at, disclosure, "rationaleSummary"),
                "simulated_narrative"
            );
            if let Some(claim) = disclosure.get("concurrentClaim") {
                assert_eq!(own(&at, claim), "simulated_narrative");
            }
            if let Some(fill) = disclosure.get("fill").filter(|fill| !fill.is_null()) {
                filled += 1;
                assert_eq!(own(&format!("{at}.fill"), fill), own(&at, disclosure));
            }
        }
        assert!(filled > 0, "some disclosed day filled");
        assert!(disclosed > 0);
        let revisions = paper["dataRevisions"].as_array().expect("revisions");
        assert!(!revisions.is_empty());
        for revision in revisions {
            // A note about a synthetic fixture fact takes the fixture's class.
            assert_eq!(own("paper.dataRevisions[]", revision), "fictional_setting");
        }
    }
}

/// A `RelationshipSignalView`: the signal is his act, the counterpart's name
/// and relation label are chassis, the quoted sentence is his words.
fn assert_signal_view(at: &str, signal: &Value) {
    assert_eq!(own(at, signal), "simulated_narrative");
    for field in ["displayName", "relationLabel"] {
        assert_eq!(
            sibling(at, signal, field),
            "fictional_setting",
            "{at}: {field}"
        );
    }
    let utterance = &signal["utterance"];
    assert!(
        utterance["canonicalTextUtf8"].is_string(),
        "{at}: no quoted sentence"
    );
    assert_eq!(
        own(&format!("{at}.utterance"), utterance),
        "simulated_narrative"
    );
}

/// The 2.2.0 nested items in the deep archive: the people a memory
/// involves and every relationship signal.
#[test]
fn nested_people_and_quotes_carry_their_own_truth_class() {
    for faults in [ProjectionFaults::default(), faulted()] {
        let documents = documents(&faults);

        let memories = document(&documents, "archive/memories.json");
        let mut people = 0;
        for memory in memories["memories"].as_array().expect("memories") {
            for person in memory["involvedPeople"].as_array().expect("involvedPeople") {
                people += 1;
                // Chassis, whatever the class of the memory that names them.
                assert_eq!(
                    own("memories[].involvedPeople[]", person),
                    "fictional_setting"
                );
            }
        }
        assert!(people > 0, "some memory involves a person");

        let relations = document(&documents, "archive/relations.json");
        let mut signals = 0;
        for acquaintance in relations["acquaintances"]
            .as_array()
            .expect("acquaintances")
        {
            for signal in acquaintance["relationshipSignals"]
                .as_array()
                .expect("relationshipSignals")
            {
                signals += 1;
                assert_signal_view("relations.acquaintances[].relationshipSignals[]", signal);
            }
        }
        assert!(signals > 0, "the slice leaves a relationship signal");
    }
}

/// Runs the same walker the other tests use, but over one already-parsed
/// document, so a test can compare a control walk against a walk over a
/// tampered in-memory clone of that same document.
fn walk_one(path: &str, document: &Value) -> Walk {
    let allow = allowlist();
    let siblings = SiblingContract::load();
    let mut out = Walk::default();
    let declared = declared_classes(document);
    walk(path, document, declared.as_ref(), &allow, &siblings, &mut out);
    out
}

/// The first `RelationshipSignalView` under `archive/relations.json`'s
/// `acquaintances[].relationshipSignals[]`, mutably, for tampering.
fn first_relationship_signal(document: &mut Value) -> &mut Map<String, Value> {
    document["acquaintances"]
        .as_array_mut()
        .expect("acquaintances")
        .iter_mut()
        .find_map(|acquaintance| {
            acquaintance["relationshipSignals"]
                .as_array_mut()
                .expect("relationshipSignals")
                .first_mut()
                .and_then(Value::as_object_mut)
        })
        .expect("some acquaintance has a relationship signal")
}

/// `life-journal.json`'s one non-null per-entry `relationshipConsequence`
/// (also a `RelationshipSignalView`, 2026-03-27 per the runbook), mutably.
fn journal_relationship_consequence(document: &mut Value) -> &mut Map<String, Value> {
    document["entries"]
        .as_array_mut()
        .expect("entries")
        .iter_mut()
        .find_map(|entry| {
            entry
                .get_mut("relationshipConsequence")
                .filter(|signal| !signal.is_null())
                .and_then(Value::as_object_mut)
        })
        .expect("some chapter leaves a relationship signal")
}

/// Deleting, or mis-setting to the signal's own `simulated_narrative`,
/// either `displayNameTruthClass` or `relationLabelTruthClass` on a
/// `RelationshipSignalView` must be caught as uncovered: it must never
/// silently read as covered by the signal's own `truthClass`. Tampers an
/// in-memory clone only -- the repo fixture on disk is untouched -- and
/// checks a control walk of the untampered document first, so a walker
/// that stopped checking anything here would fail this test's own control
/// rather than pass it vacuously.
fn assert_tamper_is_caught(
    document_suffix: &str,
    documents: &[(String, Value)],
    locate: impl Fn(&mut Value) -> &mut Map<String, Value>,
    tampers: &[(&str, Option<&str>)],
) {
    let (path, original) = documents
        .iter()
        .find(|(path, _)| path.ends_with(document_suffix))
        .unwrap_or_else(|| panic!("no document ending in {document_suffix}"));

    let control = walk_one(path, original);
    assert!(
        control.uncovered.is_empty(),
        "{path}: control walk (untampered) was already uncovered: {:?}",
        control.uncovered
    );

    for (field, corrupt_value) in tampers.iter().copied() {
        let mut tampered = original.clone();
        let target = locate(&mut tampered);
        match corrupt_value {
            None => {
                target.remove(field);
            }
            Some(value) => {
                target.insert(field.to_owned(), Value::String(value.to_owned()));
            }
        }
        let walked = walk_one(path, &tampered);
        let claim_field = field
            .strip_suffix("TruthClass")
            .expect("field name ends in TruthClass");
        assert!(
            walked
                .uncovered
                .iter()
                .any(|entry| entry.contains(claim_field)),
            "{path}: tampering {field} to {corrupt_value:?} was not caught as uncovered; got {:?}",
            walked.uncovered
        );
    }
}

/// The four ways a `RelationshipSignalView`'s counterpart identity can be
/// corrupted: either sibling deleted, or mis-set to the signal's own
/// `simulated_narrative`.
const RELATIONSHIP_SIGNAL_IDENTITY_TAMPERS: [(&str, Option<&str>); 4] = [
    ("displayNameTruthClass", None),
    ("displayNameTruthClass", Some("simulated_narrative")),
    ("relationLabelTruthClass", None),
    ("relationLabelTruthClass", Some("simulated_narrative")),
];

#[test]
fn tampered_relationship_signal_identity_is_caught() {
    let documents = documents(&ProjectionFaults::default());
    assert_tamper_is_caught(
        "archive/relations.json",
        &documents,
        |document| first_relationship_signal(document),
        &RELATIONSHIP_SIGNAL_IDENTITY_TAMPERS,
    );
    assert_tamper_is_caught(
        "life-journal.json",
        &documents,
        |document| journal_relationship_consequence(document),
        &RELATIONSHIP_SIGNAL_IDENTITY_TAMPERS,
    );
}

/// The first `PaperPositionPublic` under `archive/paper.json`'s
/// `positions[]`, mutably, for tampering.
fn first_paper_position(document: &mut Value) -> &mut Map<String, Value> {
    document["positions"]
        .as_array_mut()
        .expect("positions")
        .first_mut()
        .and_then(Value::as_object_mut)
        .expect("the fixture carries at least one paper position")
}

/// Deleting `instrumentLabelTruthClass` on a `PaperPositionPublic` must be
/// caught as uncovered: `instrumentLabel` is not itself a
/// `RelationshipSignalView`-shaped field, so before this walker read
/// `requiredSiblingTruthClasses.schemas` generically it fell back to the
/// position's own `truthClass` (present, `simulated_narrative`) and the
/// deletion silently read as covered. `instrumentLabel`'s class is not
/// pinned to one value by the contract (`requiredSiblingTruthClasses.
/// schemas.PaperPositionPublic.instrumentLabel` is `null`), so mis-setting
/// it to another legal class is not itself a violation; only the sibling's
/// absence is.
#[test]
fn tampered_paper_position_instrument_label_sibling_is_caught() {
    let documents = documents(&ProjectionFaults::default());
    assert_tamper_is_caught(
        "archive/paper.json",
        &documents,
        |document| first_paper_position(document),
        &[("instrumentLabelTruthClass", None)],
    );
}

/// `close-up.json` itself, as a `CharacterCloseUp` object (its properties
/// sit at the document's top level, alongside the envelope), mutably.
fn close_up_object(document: &mut Value) -> &mut Map<String, Value> {
    document.as_object_mut().expect("close-up.json is an object")
}

/// Mis-setting `displayNameTruthClass` to the object's own class
/// (`CharacterCloseUp` carries no top-level `truthClass` at all, so before
/// this walker read the contract's pinned classes generically, a sibling
/// merely being present -- with any value -- read as covered) must be
/// caught: the contract pins `CharacterCloseUp.displayName` to
/// `fictional_setting` specifically (a displayed name is authored chassis),
/// distinct from every claim class a close-up otherwise carries
/// (`simulated_narrative`), so `simulated_narrative` there is exactly the
/// error this walker must not wave through. Deleting the sibling outright
/// must be caught too.
#[test]
fn tampered_close_up_display_name_identity_is_caught() {
    let documents = documents(&ProjectionFaults::default());
    assert_tamper_is_caught(
        "close-up.json",
        &documents,
        |document| close_up_object(document),
        &[
            ("displayNameTruthClass", None),
            ("displayNameTruthClass", Some("simulated_narrative")),
        ],
    );
}

/// The three unclassified sentences a review found on screen are system
/// labels, each one a sentence the contract lists for its field.
#[test]
fn reviewed_reason_fields_are_listed_system_labels() {
    let allow = allowlist();
    let listed = |field: &str, value: &Value| {
        let text = value
            .as_str()
            .unwrap_or_else(|| panic!("{field} is not a string: {value}"));
        assert!(
            allow
                .labels
                .get(field)
                .is_some_and(|texts| texts.contains(text)),
            "{field} = {text:?} is not a listed system label"
        );
    };
    let documents = documents(&ProjectionFaults::default());

    let chart = document(&documents, "archive/chart.json");
    assert!(
        chart["placements"]
            .as_array()
            .expect("placements")
            .is_empty()
    );
    listed("placementsEmptyReason", &chart["placementsEmptyReason"]);

    let journal = document(&documents, "life-journal.json");
    let (mut paper_null, mut relationship_null) = (0, 0);
    for entry in journal["entries"].as_array().expect("entries") {
        let card = &entry["evidenceCard"];
        if card["paperOutcome"].is_null() {
            paper_null += 1;
            listed("paperOutcomeNullReason", &card["paperOutcomeNullReason"]);
        }
        if entry["relationshipConsequence"].is_null() {
            relationship_null += 1;
            listed(
                "relationshipConsequenceNullReason",
                &entry["relationshipConsequenceNullReason"],
            );
        }
    }
    assert_eq!(paper_null, 1, "one chapter has no paper outcome");
    assert_eq!(
        relationship_null, 28,
        "28 chapters leave no relationship signal"
    );
}

/// The contract and the list agree: every field `public-v2.yaml` marks
/// `x-panshi-system-label: true` has an entry in the list, and every listed
/// field is marked. Read as text, the way the contract audit reads it.
#[test]
fn system_label_list_matches_the_contract_markers() {
    let path = repo_root().join("contracts/openapi/public-v2.yaml");
    let yaml =
        fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    let lines: Vec<&str> = yaml.lines().collect();
    let mut marked = BTreeSet::new();
    for (index, line) in lines.iter().enumerate() {
        if line.trim() != "x-panshi-system-label: true" {
            continue;
        }
        let field = lines[..index]
            .iter()
            .rev()
            .find_map(|previous| {
                let trimmed = previous.trim();
                (previous.len() - trimmed.len() < line.len() - line.trim_start().len())
                    .then(|| trimmed.trim_end_matches(':').to_owned())
            })
            .expect("a marker sits under a property");
        marked.insert(field);
    }
    let allow = allowlist();
    let listed: BTreeSet<String> = allow.labels.keys().cloned().collect();
    assert_eq!(
        marked, listed,
        "x-panshi-system-label markers and the list disagree"
    );
    for field in &listed {
        assert!(
            is_system_label(field),
            "{field} is listed but not a system-label field name"
        );
    }
    let version_line = lines
        .iter()
        .find(|line| line.trim_start().starts_with("version: "))
        .expect("info.version");
    let list: Value = serde_json::from_str(
        &fs::read_to_string(repo_root().join("contracts/openapi/public-v2-system-labels.json"))
            .expect("system label list"),
    )
    .expect("system label list is JSON");
    assert_eq!(
        version_line.trim().trim_start_matches("version: "),
        list["contractVersion"].as_str().expect("contractVersion"),
        "the list names a different contract version than public-v2.yaml"
    );
}

/// Zero `real_fact` anywhere, as a value or as text.
#[test]
fn no_projection_claims_a_real_fact() {
    for faults in [ProjectionFaults::default(), faulted()] {
        for (path, text) in public_api_documents_with(&one_character_slice(), &faults) {
            assert_eq!(
                text.matches("real_fact").count(),
                0,
                "{path} claims a real fact in a synthetic slice"
            );
        }
    }
}
