//! Public-projection kill switches (`docs/v5/market-safety.md` "Kill switch").
//!
//! The set is a versioned document, `contracts/projection-kill-switch/v1`
//! (`ProjectionKillSwitchSetV1`). The projection reads it at emission time
//! and withholds every object a closed switch covers -- whole, never
//! rewritten, never replaced by a generated neutral version -- and puts a
//! fixed system label from `contracts/openapi/public-v2-system-labels.json`
//! where the object would have been.
//!
//! **Fail closed.** A set that is missing, unreadable, or violates any
//! assertion of the schema is not partially applied: the projection runs
//! under `ProjectionKillSwitch::fail_closed()`, which withdraws **every**
//! market-derived object from the first session on (the last published set
//! may have closed something the release-gate default leaves open, and it
//! can no longer be read), and closes ticker-specific share/short video.
//! Revision 0 is reserved for the two sets a consumer synthesises -- this
//! one and the library's release-gate default -- and each response tells
//! them apart by the kill-switch ref id; a published set starts at 1.
//!
//! The loader mirrors the schema assertion for assertion (every field
//! required, no unknown field, the same patterns and bounds), and adds the
//! one rule JSON Schema cannot express: each list is strictly ascending in
//! UTF-8 byte order, so one set has exactly one serialization.
//! `tests/projection_kill_switch.rs` runs this loader and
//! `tools/projection-kill-switch-audit.mjs` runs the schema over the same
//! valid and negative fixtures.

use std::{collections::BTreeSet, fmt, fs, path::Path};

use serde_json::{Map, Value};

/// `contractVersion` of every published set.
pub const CONTRACT_VERSION: &str = "projection-kill-switch/v1";

/// Where the one-character slice's set lives, relative to the repository
/// root (the working directory `pnpm slice:emit` runs in).
pub const SLICE_KILL_SWITCH_PATH: &str = "fixtures/v5/one-character-slice/projection-kill-switch.json";

const LIST_MAX_ITEMS: usize = 256;

/// JSON's largest exactly representable integer, the schema's `maximum`.
const MAX_REVISION: u64 = 9_007_199_254_740_991;

/// One switch that covers a whole category.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SwitchState {
    Closed,
    Open,
}

/// Where a set came from. Recorded in every response (the kill-switch
/// source ref id), so a fail-closed projection is never mistaken for a
/// published one.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum KillSwitchOrigin {
    /// A published, validated `ProjectionKillSwitchSetV1` (revision >= 1).
    Published,
    /// No set given to the library: the release-gate default (current-market
    /// projection and ticker-specific share/short video closed). Never what
    /// the emitter writes; it always reads a set.
    ReleaseGateDefault,
    /// The set was missing or invalid: every market-derived object is
    /// withdrawn.
    FailClosed,
}

impl KillSwitchOrigin {
    /// The `refId` of the `projection_kill_switch` source ref.
    #[must_use]
    pub const fn ref_id(self) -> &'static str {
        match self {
            Self::Published => "projection-kill-switch/v1",
            Self::ReleaseGateDefault => "projection-kill-switch/v1#release-gate-default",
            Self::FailClosed => "projection-kill-switch/v1#fail-closed",
        }
    }
}

/// One parsed `ProjectionKillSwitchSetV1`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectionKillSwitch {
    pub origin: KillSwitchOrigin,
    /// 0 only for the two synthesised sets.
    pub revision: u64,
    pub current_market_projection: SwitchState,
    pub ticker_specific_share_and_short_video: SwitchState,
    pub closed_fact_revision_ids: BTreeSet<String>,
    pub closed_instruments: BTreeSet<String>,
    pub closed_market_session_ids: BTreeSet<String>,
    pub closed_paper_action_reveal_dates: BTreeSet<String>,
    pub closed_story_act_ids: BTreeSet<String>,
}

/// Where the set a projection ran under came from.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum KillSwitchSource {
    /// A published set, read and validated.
    Published { revision: u64 },
    /// No usable set: `ProjectionKillSwitch::fail_closed()`, and why.
    FailClosed { reason: String },
}

/// Why a document is not a valid set.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum KillSwitchError {
    NotJson(String),
    NotAnObject,
    MissingField(&'static str),
    UnknownField(String),
    WrongContractVersion,
    InvalidRevision,
    InvalidIssuedAt,
    InvalidState(&'static str),
    NotAList(&'static str),
    TooManyItems(&'static str),
    InvalidItem { field: &'static str, index: usize },
    NotStrictlyAscending(&'static str),
}

impl fmt::Display for KillSwitchError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotJson(error) => write!(formatter, "not JSON: {error}"),
            Self::NotAnObject => write!(formatter, "the set is not a JSON object"),
            Self::MissingField(field) => write!(formatter, "missing required field {field}"),
            Self::UnknownField(field) => write!(formatter, "unknown field {field}"),
            Self::WrongContractVersion => write!(formatter, "contractVersion is not {CONTRACT_VERSION}"),
            Self::InvalidRevision => write!(formatter, "revision is not an integer in 1..=2^53-1"),
            Self::InvalidIssuedAt => write!(formatter, "issuedAt is not YYYY-MM-DDTHH:MM:SS+08:00"),
            Self::InvalidState(field) => write!(formatter, "{field} is not \"closed\" or \"open\""),
            Self::NotAList(field) => write!(formatter, "{field} is not a list of strings"),
            Self::TooManyItems(field) => write!(formatter, "{field} has more than {LIST_MAX_ITEMS} items"),
            Self::InvalidItem { field, index } => write!(formatter, "{field}[{index}] does not match its pattern"),
            Self::NotStrictlyAscending(field) => {
                write!(formatter, "{field} is not strictly ascending in UTF-8 byte order")
            }
        }
    }
}

impl std::error::Error for KillSwitchError {}

const FIELDS: [&str; 10] = [
    "contractVersion",
    "revision",
    "issuedAt",
    "currentMarketProjection",
    "tickerSpecificShareAndShortVideo",
    "closedFactRevisionIds",
    "closedInstruments",
    "closedMarketSessionIds",
    "closedPaperActionRevealDates",
    "closedStoryActIds",
];

impl ProjectionKillSwitch {
    /// The set a projection runs under when the set it was given is missing
    /// or invalid: every market-derived object is withdrawn from the first
    /// session on, ticker-specific share/short video closed.
    #[must_use]
    pub fn fail_closed() -> Self {
        Self {
            origin: KillSwitchOrigin::FailClosed,
            ..Self::release_gate_default()
        }
    }

    /// The release-gate default (`docs/v5/market-safety.md` 發布閘門): the
    /// current-market projection and ticker-specific share/short video are
    /// closed, every list is empty. What the library projects under when no
    /// set is passed.
    #[must_use]
    pub fn release_gate_default() -> Self {
        Self {
            origin: KillSwitchOrigin::ReleaseGateDefault,
            revision: 0,
            current_market_projection: SwitchState::Closed,
            ticker_specific_share_and_short_video: SwitchState::Closed,
            closed_fact_revision_ids: BTreeSet::new(),
            closed_instruments: BTreeSet::new(),
            closed_market_session_ids: BTreeSet::new(),
            closed_paper_action_reveal_dates: BTreeSet::new(),
            closed_story_act_ids: BTreeSet::new(),
        }
    }

    #[must_use]
    pub fn current_market_closed(&self) -> bool {
        self.current_market_projection == SwitchState::Closed
    }

    /// Whether this set withdraws every market-derived object (fail-closed).
    #[must_use]
    pub fn withdraws_all_market(&self) -> bool {
        self.origin == KillSwitchOrigin::FailClosed
    }

    /// Whether ticker-specific share cards and 9:16 short videos may be
    /// emitted. The one-character slice serves neither surface yet, so no
    /// emitter consults this today; any future share or short-video
    /// emitter must, and must emit nothing ticker-specific while it is
    /// `false`.
    #[must_use]
    pub fn ticker_share_and_short_video_open(&self) -> bool {
        self.ticker_specific_share_and_short_video == SwitchState::Open
    }

    /// Parses and validates one published set.
    ///
    /// # Errors
    ///
    /// Any violation of `contracts/projection-kill-switch/v1/schema.json`,
    /// or a list that is not strictly ascending in UTF-8 byte order.
    pub fn parse(text: &str) -> Result<Self, KillSwitchError> {
        let value: Value =
            serde_json::from_str(text).map_err(|error| KillSwitchError::NotJson(error.to_string()))?;
        let object = value.as_object().ok_or(KillSwitchError::NotAnObject)?;
        for key in object.keys() {
            if !FIELDS.contains(&key.as_str()) {
                return Err(KillSwitchError::UnknownField(key.clone()));
            }
        }
        let field = |name: &'static str| object.get(name).ok_or(KillSwitchError::MissingField(name));
        for name in FIELDS {
            field(name)?;
        }
        if field("contractVersion")?.as_str() != Some(CONTRACT_VERSION) {
            return Err(KillSwitchError::WrongContractVersion);
        }
        let revision = field("revision")?
            .as_u64()
            .filter(|revision| (1..=MAX_REVISION).contains(revision))
            .ok_or(KillSwitchError::InvalidRevision)?;
        if !field("issuedAt")?.as_str().is_some_and(is_taipei_timestamp) {
            return Err(KillSwitchError::InvalidIssuedAt);
        }
        Ok(Self {
            origin: KillSwitchOrigin::Published,
            revision,
            current_market_projection: state(object, "currentMarketProjection")?,
            ticker_specific_share_and_short_video: state(object, "tickerSpecificShareAndShortVideo")?,
            closed_fact_revision_ids: list(object, "closedFactRevisionIds", is_fact_revision_id)?,
            closed_instruments: list(object, "closedInstruments", is_instrument)?,
            closed_market_session_ids: list(object, "closedMarketSessionIds", is_market_session_id)?,
            closed_paper_action_reveal_dates: list(object, "closedPaperActionRevealDates", is_date)?,
            closed_story_act_ids: list(object, "closedStoryActIds", is_lowercase_uuid)?,
        })
    }

    /// Reads the set at `path`. A missing, unreadable or invalid set yields
    /// `fail_closed()` and says why; it is never partially applied.
    #[must_use]
    pub fn load(path: &Path) -> (Self, KillSwitchSource) {
        let text = match fs::read_to_string(path) {
            Ok(text) => text,
            Err(error) => {
                return (
                    Self::fail_closed(),
                    KillSwitchSource::FailClosed {
                        reason: format!("cannot read {}: {error}", path.display()),
                    },
                );
            }
        };
        match Self::parse(&text) {
            Ok(set) => {
                let revision = set.revision;
                (set, KillSwitchSource::Published { revision })
            }
            Err(error) => (
                Self::fail_closed(),
                KillSwitchSource::FailClosed {
                    reason: format!("{} is not a valid {CONTRACT_VERSION} set: {error}", path.display()),
                },
            ),
        }
    }
}

fn state(object: &Map<String, Value>, field: &'static str) -> Result<SwitchState, KillSwitchError> {
    match object.get(field).and_then(Value::as_str) {
        Some("closed") => Ok(SwitchState::Closed),
        Some("open") => Ok(SwitchState::Open),
        _ => Err(KillSwitchError::InvalidState(field)),
    }
}

fn list(
    object: &Map<String, Value>,
    field: &'static str,
    item_is_valid: fn(&str) -> bool,
) -> Result<BTreeSet<String>, KillSwitchError> {
    let items = object
        .get(field)
        .and_then(Value::as_array)
        .ok_or(KillSwitchError::NotAList(field))?;
    if items.len() > LIST_MAX_ITEMS {
        return Err(KillSwitchError::TooManyItems(field));
    }
    let mut previous: Option<&str> = None;
    let mut out = BTreeSet::new();
    for (index, item) in items.iter().enumerate() {
        let text = item.as_str().ok_or(KillSwitchError::NotAList(field))?;
        if !item_is_valid(text) {
            return Err(KillSwitchError::InvalidItem { field, index });
        }
        // `str` ordering is UTF-8 byte order.
        if previous.is_some_and(|previous| previous >= text) {
            return Err(KillSwitchError::NotStrictlyAscending(field));
        }
        previous = Some(text);
        out.insert(text.to_owned());
    }
    Ok(out)
}

// -- the schema's patterns, by hand ---------------------------------------
//
// Each function is the exact language of the `pattern` (and length bounds)
// its field carries in `schema.json`. The workspace has no regex crate and
// these grammars do not warrant one.

/// One or more non-empty runs of `is_char`, separated by single `separator`s.
fn is_segmented(text: &str, separator: char, is_char: fn(char) -> bool) -> bool {
    !text.is_empty()
        && text
            .split(separator)
            .all(|segment| !segment.is_empty() && segment.chars().all(is_char))
}

fn is_lower_alphanumeric(character: char) -> bool {
    character.is_ascii_lowercase() || character.is_ascii_digit()
}

fn is_upper_alphanumeric(character: char) -> bool {
    character.is_ascii_uppercase() || character.is_ascii_digit()
}

fn is_alphanumeric(character: char) -> bool {
    character.is_ascii_alphanumeric()
}

fn length_within(text: &str, minimum: usize, maximum: usize) -> bool {
    (minimum..=maximum).contains(&text.chars().count())
}

/// `^(fact-[a-z0-9]+(-[a-z0-9]+)*|sf_[A-Za-z0-9]+(_[A-Za-z0-9]+)*)$`, 6..=128.
fn is_fact_revision_id(text: &str) -> bool {
    length_within(text, 6, 128)
        && (text
            .strip_prefix("fact-")
            .is_some_and(|rest| is_segmented(rest, '-', is_lower_alphanumeric))
            || text
                .strip_prefix("sf_")
                .is_some_and(|rest| is_segmented(rest, '_', is_alphanumeric)))
}

/// `^[A-Z0-9]+(-[A-Z0-9]+)*$`, 1..=32.
fn is_instrument(text: &str) -> bool {
    length_within(text, 1, 32) && is_segmented(text, '-', is_upper_alphanumeric)
}

/// `^(session-[a-z0-9]+(-[a-z0-9]+)*|mkts_[A-Za-z0-9]+(_[A-Za-z0-9]+)*)$`, 6..=128.
fn is_market_session_id(text: &str) -> bool {
    length_within(text, 6, 128)
        && (text
            .strip_prefix("session-")
            .is_some_and(|rest| is_segmented(rest, '-', is_lower_alphanumeric))
            || text
                .strip_prefix("mkts_")
                .is_some_and(|rest| is_segmented(rest, '_', is_alphanumeric)))
}

fn two_digits_within(text: &str, minimum: u32, maximum: u32) -> bool {
    text.len() == 2
        && text.chars().all(|character| character.is_ascii_digit())
        && text
            .parse::<u32>()
            .is_ok_and(|value| (minimum..=maximum).contains(&value))
}

/// `^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$`.
fn is_date(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() == 10
        && text.is_ascii()
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[4] == b'-'
        && two_digits_within(&text[5..7], 1, 12)
        && bytes[7] == b'-'
        && two_digits_within(&text[8..10], 1, 31)
}

/// `^<date>T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\+08:00$`.
fn is_taipei_timestamp(text: &str) -> bool {
    text.len() == 25
        && text.is_ascii()
        && is_date(&text[..10])
        && &text[10..11] == "T"
        && two_digits_within(&text[11..13], 0, 23)
        && &text[13..14] == ":"
        && two_digits_within(&text[14..16], 0, 59)
        && &text[16..17] == ":"
        && two_digits_within(&text[17..19], 0, 59)
        && &text[19..] == "+08:00"
}

/// `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`.
fn is_lowercase_uuid(text: &str) -> bool {
    text.len() == 36
        && text.char_indices().all(|(index, character)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                character == '-'
            } else {
                character.is_ascii_digit() || matches!(character, 'a'..='f')
            }
        })
}

#[cfg(test)]
mod tests {
    use super::{
        is_date, is_fact_revision_id, is_instrument, is_lowercase_uuid, is_market_session_id,
        is_taipei_timestamp,
    };

    #[test]
    fn hand_written_patterns_accept_and_reject_like_the_schema() {
        assert!(is_fact_revision_id("fact-hist-001-s07-correction"));
        assert!(is_fact_revision_id("sf_2026_0414_000123"));
        assert!(!is_fact_revision_id("fact-"));
        assert!(!is_fact_revision_id("fact-a--b"));
        assert!(!is_fact_revision_id("fact-Hist"));
        assert!(!is_fact_revision_id("sf__x"));
        assert!(is_instrument("PSZS-DEMO"));
        assert!(!is_instrument("PSZS-"));
        assert!(!is_instrument("pszs"));
        assert!(is_market_session_id("session-hist-001-s20"));
        assert!(is_market_session_id("mkts_20260414_twse"));
        assert!(!is_market_session_id("session-"));
        assert!(is_date("2026-04-13"));
        assert!(!is_date("2026-04-32"));
        assert!(!is_date("2026-00-01"));
        assert!(is_taipei_timestamp("2026-04-14T14:05:00+08:00"));
        assert!(!is_taipei_timestamp("2026-04-14T24:05:00+08:00"));
        assert!(!is_taipei_timestamp("2026-04-14T14:05:00Z"));
        assert!(is_lowercase_uuid("78771f77-daa5-0065-ddbf-4223f69c881f"));
        assert!(!is_lowercase_uuid("78771F77-daa5-0065-ddbf-4223f69c881f"));
    }
}
