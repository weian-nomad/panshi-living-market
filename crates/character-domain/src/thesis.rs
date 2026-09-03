//! Append-only thesis revision chain
//! (`docs/v5/character-story-engine.md` "信念與自我敘述": "人物不能靜默修改
//! 原始理由"; `docs/v5/decision-record.md` 資訊裁決 "原始理由與改口 ->
//! `/archive/*` 完整 revision").
//!
//! `character::CommitmentRationale` already carries ONE open, quote-free
//! rationale. What it cannot express is the thing the life journal has to
//! show: a character who *switched* the stated reason for a position he
//! still holds, and whether that switch was backed by any new evidence.
//! This module adds exactly that -- an ordered, append-only chain of
//! rationale revisions, plus the two mechanically decidable questions the
//! journal asks of it:
//!
//! 1. `newly_supported_facts` -- which supporting facts did the new revision
//!    add that the previous one did not have? An empty answer is the
//!    machine-checkable evidence of rationalization; it is never inferred
//!    from tone, wording, or a model's opinion.
//! 2. `evaluate_invalidation` -- has the revision's own stated invalidation
//!    condition come true (its intended horizon has passed with no new
//!    supporting evidence)?
//!
//! Pure domain: no I/O, no clock, no randomness. The caller supplies `now`,
//! exactly like the rest of this crate's aggregates take explicit times
//! rather than reading a clock.

use panshi_decision_kernel::Fixed;

/// One immutable revision of a character's structured, quote-free reason for
/// holding a paper position. Never rewritten: a change of mind appends a new
/// revision (`docs/v5/character-story-engine.md`: "永遠只存 structured
/// rationale，不含 quote 或 artifact" -- the spoken version of the same change
/// is a separate `UtteranceArtifact`, not an edit of this record).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ThesisRevision {
    pub thesis_revision_id: &'static str,
    pub opened_at_unix_micros: i64,
    pub intended_horizon_unix_micros: i64,
    pub invalidation_condition_code: &'static str,
    pub support_fact_revision_ids: &'static [&'static str],
    pub confidence: Fixed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ThesisChainError {
    DuplicateRevisionId,
    RevisionTimeWentBackwards,
}

/// An append-only chain of `ThesisRevision`s for one open commitment. There
/// is deliberately no `remove`, `replace`, or `set` -- the only mutation is
/// `push`, so a "quiet edit" of an earlier reason is structurally
/// unrepresentable rather than merely discouraged.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ThesisRevisionChain {
    revisions: Vec<ThesisRevision>,
}

impl ThesisRevisionChain {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            revisions: Vec::new(),
        }
    }

    /// Appends the next revision.
    ///
    /// # Errors
    ///
    /// Rejects a `thesis_revision_id` already in the chain, and rejects a
    /// revision opened at or before the current head (a chain whose order
    /// can be argued about cannot support a "he changed his story on day N"
    /// claim).
    pub fn push(&mut self, revision: ThesisRevision) -> Result<(), ThesisChainError> {
        if self
            .revisions
            .iter()
            .any(|existing| existing.thesis_revision_id == revision.thesis_revision_id)
        {
            return Err(ThesisChainError::DuplicateRevisionId);
        }
        if let Some(head) = self.revisions.last()
            && revision.opened_at_unix_micros <= head.opened_at_unix_micros
        {
            return Err(ThesisChainError::RevisionTimeWentBackwards);
        }
        self.revisions.push(revision);
        Ok(())
    }

    #[must_use]
    pub fn revisions(&self) -> &[ThesisRevision] {
        &self.revisions
    }

    #[must_use]
    pub fn first(&self) -> Option<&ThesisRevision> {
        self.revisions.first()
    }

    #[must_use]
    pub fn latest(&self) -> Option<&ThesisRevision> {
        self.revisions.last()
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.revisions.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.revisions.is_empty()
    }
}

/// The supporting facts `next` cites that `prev` did not, in `next`'s own
/// order, de-duplicated. An empty result is the whole point: it is the
/// mechanical evidence that a rewritten reason brought no new evidence with
/// it (`docs/v5/character-story-engine.md` 第四天: "新增支持資料：0").
#[must_use]
pub fn newly_supported_facts<'a>(
    prev: &ThesisRevision,
    next: &'a ThesisRevision,
) -> Vec<&'a str> {
    let mut added: Vec<&'a str> = Vec::new();
    for candidate in next.support_fact_revision_ids {
        if prev.support_fact_revision_ids.contains(candidate) {
            continue;
        }
        if added.contains(candidate) {
            continue;
        }
        added.push(candidate);
    }
    added
}

/// Whether a revision's own stated invalidation condition has come true.
/// `UnknownAtTheTime` is a first-class answer, not an error: asking about a
/// moment before the revision was even opened must fail closed rather than
/// guess (`AGENTS.md`: "Missing, stale, conflicting... facts fail closed").
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InvalidationState {
    NotYetOccurred,
    Occurred,
    UnknownAtTheTime,
}

/// Evaluates `revision`'s invalidation condition at `now`.
///
/// The rule is deliberately narrow and fully mechanical: once the revision's
/// own `intended_horizon_unix_micros` has passed and no new supporting fact
/// has been added since it was opened, the condition it declared for itself
/// has occurred. Price direction is NOT an input -- a character is never
/// judged wrong by the market here, only by the expiry he himself wrote down
/// (`docs/v5/character-story-engine.md` 第四天: "系統沒有自動賣出，也沒有自動
/// 判他錯").
#[must_use]
pub const fn evaluate_invalidation(
    revision: &ThesisRevision,
    now_unix_micros: i64,
    new_supporting_fact_count: usize,
) -> InvalidationState {
    if now_unix_micros < revision.opened_at_unix_micros {
        return InvalidationState::UnknownAtTheTime;
    }
    if now_unix_micros > revision.intended_horizon_unix_micros && new_supporting_fact_count == 0 {
        return InvalidationState::Occurred;
    }
    InvalidationState::NotYetOccurred
}

#[cfg(test)]
mod tests {
    use super::{
        InvalidationState, ThesisChainError, ThesisRevision, ThesisRevisionChain,
        evaluate_invalidation, newly_supported_facts,
    };
    use panshi_decision_kernel::Fixed;

    const MOMENTUM_SUPPORT: [&str; 2] = ["fact-hist-001-momentum", "fact-hist-001-s2-close"];
    const GOVERNANCE_SUPPORT: [&str; 2] = ["fact-hist-001-momentum", "fact-hist-001-s2-close"];
    const GOVERNANCE_SUPPORT_WITH_NEW_EVIDENCE: [&str; 3] = [
        "fact-hist-001-momentum",
        "fact-hist-001-s2-close",
        "fact-hist-001-correction-s4",
    ];

    fn first_revision() -> ThesisRevision {
        ThesisRevision {
            thesis_revision_id: "thesis-hist-001",
            opened_at_unix_micros: 1_772_505_720_000_000,
            intended_horizon_unix_micros: 1_772_688_600_000_000,
            invalidation_condition_code: "two_session_momentum_expired",
            support_fact_revision_ids: &MOMENTUM_SUPPORT,
            confidence: Fixed::from_raw(500_000),
        }
    }

    fn second_revision() -> ThesisRevision {
        ThesisRevision {
            thesis_revision_id: "thesis-hist-002",
            opened_at_unix_micros: 1_773_108_000_000_000,
            intended_horizon_unix_micros: 1_773_811_800_000_000,
            invalidation_condition_code: "two_session_momentum_expired",
            support_fact_revision_ids: &GOVERNANCE_SUPPORT,
            confidence: Fixed::from_raw(550_000),
        }
    }

    #[test]
    fn duplicate_revision_id_is_rejected() {
        let mut chain = ThesisRevisionChain::new();
        chain.push(first_revision()).expect("first revision");
        assert_eq!(
            chain.push(first_revision()),
            Err(ThesisChainError::DuplicateRevisionId)
        );
        assert_eq!(chain.len(), 1);
    }

    #[test]
    fn a_revision_cannot_be_backdated_before_the_current_head() {
        let mut chain = ThesisRevisionChain::new();
        chain.push(second_revision()).expect("later revision first");
        assert_eq!(
            chain.push(first_revision()),
            Err(ThesisChainError::RevisionTimeWentBackwards)
        );
    }

    /// The rationalization case: the stated reason changed, the evidence did
    /// not. This is the only signal the product is allowed to call
    /// "合理化" -- it is decided by set difference, never by wording.
    #[test]
    fn a_rewritten_reason_with_the_same_evidence_adds_no_new_supporting_facts() {
        let next = second_revision();
        let added = newly_supported_facts(&first_revision(), &next);
        assert!(added.is_empty());
    }

    /// Counter-example: an honest revision that arrives WITH new evidence is
    /// not rationalization, and this function must say so.
    #[test]
    fn a_revision_backed_by_new_evidence_reports_the_new_facts() {
        let mut revised = second_revision();
        revised.support_fact_revision_ids = &GOVERNANCE_SUPPORT_WITH_NEW_EVIDENCE;
        let added = newly_supported_facts(&first_revision(), &revised);
        assert_eq!(added, vec!["fact-hist-001-correction-s4"]);
    }

    #[test]
    fn invalidation_occurs_once_the_horizon_passes_with_no_new_evidence() {
        let revision = first_revision();
        assert_eq!(
            evaluate_invalidation(&revision, revision.intended_horizon_unix_micros + 1, 0),
            InvalidationState::Occurred
        );
    }

    /// Counter-example: the same expired horizon does NOT invalidate the
    /// thesis when new supporting evidence has arrived, because the
    /// condition the character wrote down was "no new evidence within two
    /// sessions", not "two sessions passed".
    #[test]
    fn invalidation_does_not_occur_when_new_evidence_arrived() {
        let revision = first_revision();
        assert_eq!(
            evaluate_invalidation(&revision, revision.intended_horizon_unix_micros + 1, 1),
            InvalidationState::NotYetOccurred
        );
    }

    #[test]
    fn asking_before_the_revision_existed_fails_closed_as_unknown() {
        let revision = first_revision();
        assert_eq!(
            evaluate_invalidation(&revision, revision.opened_at_unix_micros - 1, 0),
            InvalidationState::UnknownAtTheTime
        );
    }

    #[test]
    fn the_chain_keeps_both_revisions_in_order() {
        let mut chain = ThesisRevisionChain::new();
        chain.push(first_revision()).expect("first");
        chain.push(second_revision()).expect("second");
        assert_eq!(chain.len(), 2);
        assert_eq!(
            chain.first().expect("first").thesis_revision_id,
            "thesis-hist-001"
        );
        assert_eq!(
            chain.latest().expect("latest").thesis_revision_id,
            "thesis-hist-002"
        );
    }
}
