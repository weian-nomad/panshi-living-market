//! Deterministic cognitive-bias predicates
//! (`AGENTS.md` product invariant: "Characters need recognizable fallible
//! patterns such as FOMO, anchoring, sunk-cost escalation, disposition
//! effect, blame, self-attribution, and narrative switching. These patterns
//! must arise from state and history, not random jokes or a visible
//! 「leek score」").
//!
//! Every predicate below is a pure function of already-canonical session
//! signals: what the character missed, what he selected, how his FOMO
//! reading moved, whether his own stated invalidation condition fired, how
//! long he has held, whether the paper loss widened, what he did, and
//! whether he changed his stated reason without adding evidence. No
//! randomness, no scoring, no ranking, and deliberately no aggregate "bias
//! score" -- there is nothing here that could be summed into a leaderboard
//! or a 「菜度」 rating, only per-occurrence observations with the exact
//! sessions that evidence them.
//!
//! `BlameShift` follows the same discipline. Whom he names is generated
//! upstream from state and history (`attribution::attribute_outcome`); this
//! module only checks the named party against the canonical record of the
//! losing decision. Naming a source he actually relied on, and which the
//! fixture itself later corrected as wrong, is a legitimate complaint and is
//! never observed as blame (`docs/v5/character-story-engine.md`: "對方確實提供
//! 錯誤資訊時，追究責任不能被標成甩鍋").
//!
//! What this module is NOT: a judgement of whether the character was right.
//! `SunkCostEscalation` fires on the character's own expired condition plus
//! a widening loss, never on "the price went the other way"; a character who
//! holds through a drawdown with his stated condition intact produces no
//! observation at all.

use crate::attribution::AttributionTarget;
use crate::cognition::ActionKind;
use crate::thesis::InvalidationState;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BiasKind {
    FomoChase,
    ConfirmationBias,
    SunkCostEscalation,
    RationalizationSwitch,
    /// A recognized loss publicly pinned on someone or something that did not
    /// shape the losing decision, or that shaped it without ever being shown
    /// to be wrong.
    BlameShift,
}

/// Everything one market session contributes to bias detection, already
/// derived from canonical events (`AttentionCommittedV1`,
/// `CharacterStateAdvancedV1`, `AutonomousActionIntentCommittedV1`,
/// `PaperMarkAppliedV1`, `PaperPositionAdjustedV1`,
/// `SemanticSpeechActCommittedV1.outcome_attribution`, the sealed fact
/// fixture's supersession links, and the thesis chain). Nothing here is a
/// free judgement: each field maps to a sealed payload field.
// Each flag mirrors one independent sealed payload fact; folding them into a
// state machine would invent an ordering the record does not have.
#[allow(clippy::struct_excessive_bools)]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionSignals {
    pub session_index: usize,
    pub missed_high_salience_count: usize,
    pub missed_fact_ids: Vec<&'static str>,
    pub selected_fact_ids: Vec<&'static str>,
    pub fomo_bp_before: i32,
    pub fomo_bp_after: i32,
    pub invalidation: InvalidationState,
    pub held_days: u32,
    pub intended_horizon_days: u32,
    pub unrealized_pnl_worsened: bool,
    pub action: ActionKind,
    pub thesis_changed: bool,
    pub newly_supported_fact_count: usize,
    /// A loss became known to him in this session: a realized loss
    /// (`PaperPositionAdjustedV1.realized_pnl_delta_fixed < 0`), or an
    /// unrealized loss that widened on the latest sealed mark he could see
    /// when he decided (`PaperMarkAppliedV1`).
    pub loss_recognized: bool,
    /// Whom his public statement in this session named
    /// (`SemanticSpeechActCommittedV1.outcome_attribution`); `None` when he
    /// made no such statement.
    pub public_attribution: Option<AttributionTarget>,
    /// Whether the named party appears in the refs of the committed intent
    /// that opened the losing exposure
    /// (`outcome_attribution.loss_decision_episode_id` ->
    /// `AutonomousActionIntentCommittedV1.perceived_fact_revision_ids`).
    pub attribution_target_in_decision_refs: bool,
    /// Whether the sealed fact fixture published a correction superseding
    /// the named party (`supersedesFactRevisionId`) by the time he spoke. A
    /// person who never supplied a sealed fact can never satisfy this.
    pub attribution_target_was_corrected: bool,
}

/// One occurrence of one pattern. `evidence_session_indices` always lists
/// every session a reader would have to open to check the claim themselves
/// -- the life journal renders these as links back to canonical events, so a
/// pattern claim is never an assertion the viewer has to take on trust.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BiasObservation {
    pub kind: BiasKind,
    pub session_index: usize,
    pub evidence_session_indices: Vec<usize>,
}

/// The FOMO jump (in basis points) a session must show before a following
/// paper purchase can be attributed to chasing rather than to evidence.
const FOMO_CHASE_MIN_RISE_BP: i32 = 3_000;

/// How many consecutive sessions the same counter-evidence must be
/// available-but-unselected before it counts as confirmation bias. Two is
/// the minimum that can distinguish a pattern from a single busy morning.
const CONFIRMATION_BIAS_MIN_RUN: usize = 2;

/// Observes every bias occurrence across an ordered run of sessions.
///
/// `signals` must be in world order (oldest first) and adjacent entries must
/// be adjacent sessions: `FomoChase` and `ConfirmationBias` both reason
/// about consecutive sessions, and a caller that hands over a filtered or
/// re-sorted slice would be asking a different question than the journal
/// does.
///
/// Output order is deterministic: sessions in order, and within one session
/// the fixed order `FomoChase`, `ConfirmationBias`, `SunkCostEscalation`,
/// `RationalizationSwitch`, `BlameShift`.
#[must_use]
pub fn observe(signals: &[SessionSignals]) -> Vec<BiasObservation> {
    let confirmation_runs = confirmation_bias_runs(signals);
    let mut observations = Vec::new();

    for (position, session) in signals.iter().enumerate() {
        if let Some(trigger) = fomo_chase_trigger_for(signals, position) {
            observations.push(BiasObservation {
                kind: BiasKind::FomoChase,
                session_index: session.session_index,
                evidence_session_indices: vec![
                    signals[trigger].session_index,
                    session.session_index,
                ],
            });
        }

        if let Some(evidence) = confirmation_runs[position].clone() {
            observations.push(BiasObservation {
                kind: BiasKind::ConfirmationBias,
                session_index: session.session_index,
                evidence_session_indices: evidence,
            });
        }

        if session.invalidation == InvalidationState::Occurred
            && session.held_days > session.intended_horizon_days
            && session.unrealized_pnl_worsened
            && session.action != ActionKind::PaperSell
        {
            observations.push(BiasObservation {
                kind: BiasKind::SunkCostEscalation,
                session_index: session.session_index,
                evidence_session_indices: vec![session.session_index],
            });
        }

        if session.thesis_changed && session.newly_supported_fact_count == 0 {
            observations.push(BiasObservation {
                kind: BiasKind::RationalizationSwitch,
                session_index: session.session_index,
                evidence_session_indices: vec![session.session_index],
            });
        }

        if is_blame_shift(session) {
            observations.push(BiasObservation {
                kind: BiasKind::BlameShift,
                session_index: session.session_index,
                evidence_session_indices: vec![session.session_index],
            });
        }
    }

    observations
}

/// How many times `kind` was observed. Used by the life journal for
/// "老毛病又回來了" -- a recurrence statement about ONE character's own
/// history. It is never compared across characters
/// (`AGENTS.md`: "No global paper-performance leaderboard").
#[must_use]
pub fn recurrence_count(observations: &[BiasObservation], kind: BiasKind) -> usize {
    observations
        .iter()
        .filter(|observation| observation.kind == kind)
        .count()
}

/// How many times `kind` was already observed BEFORE `session_index`.
///
/// This is the number a chapter may speak about, and the distinction matters:
/// a chapter covering session N may only say "this has happened before" on
/// the strength of sessions that had already closed when it was written. It
/// may not count its own session's observation as prior history.
#[must_use]
pub fn recurrence_count_before(
    observations: &[BiasObservation],
    kind: BiasKind,
    session_index: usize,
) -> usize {
    observations
        .iter()
        .filter(|observation| {
            observation.kind == kind && observation.session_index < session_index
        })
        .count()
}

/// The threshold at which a pattern may be described as recurring rather
/// than as a one-off. Two prior occurrences, not counting the current
/// session's own.
pub const RECURRENCE_THRESHOLD: usize = 2;

/// Whether a chapter for `session_index` may say the pattern has come back.
#[must_use]
pub fn is_recurring_at(
    observations: &[BiasObservation],
    kind: BiasKind,
    session_index: usize,
) -> bool {
    recurrence_count_before(observations, kind, session_index) >= RECURRENCE_THRESHOLD
}

/// Loss, plus an external target, plus a target that either played no part
/// in the losing decision or played a part without ever being shown to be
/// wrong. The one exempt case is the honest complaint: the named source is
/// in his own decision refs AND the fixture later corrected it.
fn is_blame_shift(session: &SessionSignals) -> bool {
    let Some(target) = session.public_attribution else {
        return false;
    };
    session.loss_recognized
        && target.is_external()
        && !(session.attribution_target_in_decision_refs
            && session.attribution_target_was_corrected)
}

/// The index of the session whose missed high-salience fact plus FOMO spike
/// preceded the paper purchase at `position`, if any. Attribution lands on
/// the purchase session, because that is where the character actually bore
/// the consequence; the trigger session stays in the evidence list.
fn fomo_chase_trigger_for(signals: &[SessionSignals], position: usize) -> Option<usize> {
    if signals[position].action != ActionKind::PaperBuy {
        return None;
    }
    let trigger = position.checked_sub(1)?;
    let previous = &signals[trigger];
    if previous.missed_high_salience_count == 0 {
        return None;
    }
    let rise = previous
        .fomo_bp_after
        .checked_sub(previous.fomo_bp_before)?;
    if rise < FOMO_CHASE_MIN_RISE_BP {
        return None;
    }
    Some(trigger)
}

/// For each position, the evidence sessions of a confirmation-bias run that
/// position belongs to (or `None`). A run is a maximal stretch of
/// consecutive sessions in which one and the same fact revision sits in
/// `missed_fact_ids` and never in that session's `selected_fact_ids`.
fn confirmation_bias_runs(signals: &[SessionSignals]) -> Vec<Option<Vec<usize>>> {
    let mut per_position: Vec<Option<Vec<usize>>> = vec![None; signals.len()];

    let mut candidates: Vec<&'static str> = Vec::new();
    for session in signals {
        for fact in &session.missed_fact_ids {
            if !candidates.contains(fact) {
                candidates.push(fact);
            }
        }
    }

    for fact in candidates {
        let mut run: Vec<usize> = Vec::new();
        for position in 0..=signals.len() {
            let qualifies = position < signals.len()
                && signals[position].missed_fact_ids.contains(&fact)
                && !signals[position].selected_fact_ids.contains(&fact);
            if qualifies {
                run.push(position);
                continue;
            }
            if run.len() >= CONFIRMATION_BIAS_MIN_RUN {
                let evidence: Vec<usize> = run
                    .iter()
                    .map(|member| signals[*member].session_index)
                    .collect();
                for member in &run {
                    per_position[*member] = Some(evidence.clone());
                }
            }
            run.clear();
        }
    }

    per_position
}

#[cfg(test)]
mod tests {
    use super::{
        BiasKind, BiasObservation, SessionSignals, is_recurring_at, observe, recurrence_count,
        recurrence_count_before,
    };
    use crate::attribution::AttributionTarget;
    use crate::cognition::ActionKind;
    use crate::thesis::InvalidationState;

    const COUNTER: &str = "fact-hist-001-s01-counter-inventory";
    const MOMENTUM: &str = "fact-hist-001-s01-momentum";
    const COLLEAGUE: &str = "acq-hist-001-xiaoyu";

    fn quiet_session(session_index: usize) -> SessionSignals {
        SessionSignals {
            session_index,
            missed_high_salience_count: 0,
            missed_fact_ids: Vec::new(),
            selected_fact_ids: Vec::new(),
            fomo_bp_before: 1_100,
            fomo_bp_after: 1_100,
            invalidation: InvalidationState::UnknownAtTheTime,
            held_days: 0,
            intended_horizon_days: 2,
            unrealized_pnl_worsened: false,
            action: ActionKind::Wait,
            thesis_changed: false,
            newly_supported_fact_count: 0,
            loss_recognized: false,
            public_attribution: None,
            attribution_target_in_decision_refs: false,
            attribution_target_was_corrected: false,
        }
    }

    /// A loss he named someone else for: the colleague is in no decision
    /// ref and supplied no fact that was ever corrected.
    fn named_colleague_after_loss(session_index: usize) -> SessionSignals {
        let mut session = quiet_session(session_index);
        session.loss_recognized = true;
        session.public_attribution = Some(AttributionTarget::ExternalCharacter(COLLEAGUE));
        session
    }

    fn kinds_at(observations: &[BiasObservation], session_index: usize) -> Vec<BiasKind> {
        observations
            .iter()
            .filter(|observation| observation.session_index == session_index)
            .map(|observation| observation.kind)
            .collect()
    }

    // -- FomoChase -----------------------------------------------------------

    #[test]
    fn fomo_chase_requires_a_missed_high_salience_fact() {
        // Positive: session 1 missed the early move and FOMO jumped
        // 1_100 -> 4_600; session 2 buys.
        let mut trigger = quiet_session(1);
        trigger.missed_high_salience_count = 1;
        trigger.missed_fact_ids = vec![MOMENTUM];
        trigger.fomo_bp_after = 4_600;
        let mut buy = quiet_session(2);
        buy.action = ActionKind::PaperBuy;
        let observed = observe(&[trigger.clone(), buy.clone()]);
        assert_eq!(kinds_at(&observed, 2), vec![BiasKind::FomoChase]);
        assert_eq!(
            observed
                .iter()
                .find(|observation| observation.kind == BiasKind::FomoChase)
                .expect("fomo chase")
                .evidence_session_indices,
            vec![1, 2]
        );

        // Near-miss counter-example: the same FOMO spike with NOTHING
        // missed is just an excited morning, not a chase.
        let mut spike_without_miss = trigger.clone();
        spike_without_miss.missed_high_salience_count = 0;
        spike_without_miss.missed_fact_ids = Vec::new();
        let observed = observe(&[spike_without_miss, buy.clone()]);
        assert!(kinds_at(&observed, 2).is_empty());

        // Near-miss counter-example: a missed fact WITHOUT the FOMO rise
        // (below the 3_000bp bar) is also not a chase.
        let mut miss_without_spike = trigger;
        miss_without_spike.fomo_bp_after = 3_900;
        let observed = observe(&[miss_without_spike, buy]);
        assert!(kinds_at(&observed, 2).is_empty());
    }

    #[test]
    fn fomo_chase_does_not_trigger_when_new_evidence_arrives() {
        // Pressure released: the character misses nothing, FOMO falls, and
        // the paper action is a sell driven by new evidence. Nothing here
        // may be labelled a chase.
        let mut evidence_session = quiet_session(5);
        evidence_session.selected_fact_ids = vec![COUNTER];
        evidence_session.fomo_bp_before = 4_800;
        evidence_session.fomo_bp_after = 2_600;
        let mut sell = quiet_session(6);
        sell.action = ActionKind::PaperSell;
        let observed = observe(&[evidence_session, sell]);
        assert_eq!(recurrence_count(&observed, BiasKind::FomoChase), 0);
    }

    // -- ConfirmationBias ----------------------------------------------------

    #[test]
    fn confirmation_bias_recurs_at_least_twice() {
        // Positive: the same counter-evidence sits unselected for three
        // consecutive sessions.
        let mut sessions = Vec::new();
        for session_index in 2..=4 {
            let mut session = quiet_session(session_index);
            session.missed_fact_ids = vec![COUNTER];
            sessions.push(session);
        }
        let observed = observe(&sessions);
        assert_eq!(recurrence_count(&observed, BiasKind::ConfirmationBias), 3);
        assert!(recurrence_count(&observed, BiasKind::ConfirmationBias) >= 2);

        // Near-miss counter-example: missing it exactly once is a busy
        // morning, not a pattern.
        let observed = observe(&sessions[..1]);
        assert_eq!(recurrence_count(&observed, BiasKind::ConfirmationBias), 0);

        // Near-miss counter-example: missing it, then reading it, then
        // missing it again breaks the run -- two isolated misses are not a
        // run of two.
        let mut read_it = quiet_session(3);
        read_it.selected_fact_ids = vec![COUNTER];
        let broken = vec![sessions[0].clone(), read_it, sessions[2].clone()];
        assert_eq!(
            recurrence_count(&observe(&broken), BiasKind::ConfirmationBias),
            0
        );

        // Pressure released: once the fact is selected, later sessions
        // produce no further observations.
        let mut released = sessions.clone();
        let mut acknowledged = quiet_session(5);
        acknowledged.selected_fact_ids = vec![COUNTER];
        released.push(acknowledged);
        let observed = observe(&released);
        assert_eq!(recurrence_count(&observed, BiasKind::ConfirmationBias), 3);
        assert!(kinds_at(&observed, 5).is_empty());
    }

    #[test]
    fn a_fact_that_is_both_missed_and_selected_in_the_same_session_is_not_counted() {
        // Defensive: a session that both missed and selected the same
        // revision (a correction arriving mid-session) must not be read as
        // avoidance.
        let mut sessions = Vec::new();
        for session_index in 2..=4 {
            let mut session = quiet_session(session_index);
            session.missed_fact_ids = vec![COUNTER];
            session.selected_fact_ids = vec![COUNTER];
            sessions.push(session);
        }
        assert_eq!(
            recurrence_count(&observe(&sessions), BiasKind::ConfirmationBias),
            0
        );
    }

    // -- SunkCostEscalation --------------------------------------------------

    #[test]
    fn sunk_cost_escalation_holds_after_invalidation_occurred() {
        // Positive: his own condition fired, he is past his own horizon,
        // the loss widened, and he still did not sell.
        let mut holding = quiet_session(3);
        holding.invalidation = InvalidationState::Occurred;
        holding.held_days = 3;
        holding.intended_horizon_days = 2;
        holding.unrealized_pnl_worsened = true;
        let observed = observe(std::slice::from_ref(&holding));
        assert_eq!(kinds_at(&observed, 3), vec![BiasKind::SunkCostEscalation]);

        // Near-miss counter-example: the same widening loss while the
        // stated condition has NOT fired is just holding a live thesis.
        let mut live_thesis = holding.clone();
        live_thesis.invalidation = InvalidationState::NotYetOccurred;
        assert!(kinds_at(&observe(std::slice::from_ref(&live_thesis)), 3).is_empty());

        // Near-miss counter-example: condition fired but still inside the
        // horizon he wrote down.
        let mut inside_horizon = holding.clone();
        inside_horizon.held_days = 2;
        assert!(kinds_at(&observe(std::slice::from_ref(&inside_horizon)), 3).is_empty());

        // Pressure released: the identical state, but he sold.
        let mut sold = holding;
        sold.action = ActionKind::PaperSell;
        assert!(kinds_at(&observe(std::slice::from_ref(&sold)), 3).is_empty());
    }

    // -- RationalizationSwitch -----------------------------------------------

    #[test]
    fn rationalization_switch_needs_a_changed_thesis_with_no_new_evidence() {
        // Positive.
        let mut switched = quiet_session(4);
        switched.thesis_changed = true;
        switched.newly_supported_fact_count = 0;
        assert_eq!(
            kinds_at(&observe(std::slice::from_ref(&switched)), 4),
            vec![BiasKind::RationalizationSwitch]
        );

        // Near-miss counter-example: a thesis revised WITH new supporting
        // evidence is an honest update, not a rationalization.
        let mut honest = switched.clone();
        honest.newly_supported_fact_count = 1;
        assert!(kinds_at(&observe(std::slice::from_ref(&honest)), 4).is_empty());

        // Pressure released: no thesis change at all in a later session.
        let unchanged = quiet_session(5);
        assert!(kinds_at(&observe(std::slice::from_ref(&unchanged)), 5).is_empty());
    }

    // -- BlameShift ----------------------------------------------------------

    #[test]
    fn blame_shift_fires_when_the_named_party_played_no_part_in_the_losing_decision() {
        // Positive: a recognized loss, pinned publicly on a colleague who is
        // in none of the losing decision's refs and never supplied a fact
        // that was later corrected.
        let observed = observe(&[named_colleague_after_loss(20)]);
        assert_eq!(kinds_at(&observed, 20), vec![BiasKind::BlameShift]);

        // Near-miss that still counts: the named source WAS in his refs, but
        // nothing ever showed it to be wrong. Relying on a sound fact and
        // then blaming it is still shifting the loss.
        let mut relied_on_sound_source = quiet_session(21);
        relied_on_sound_source.loss_recognized = true;
        relied_on_sound_source.public_attribution =
            Some(AttributionTarget::ExternalSource(MOMENTUM));
        relied_on_sound_source.attribution_target_in_decision_refs = true;
        relied_on_sound_source.attribution_target_was_corrected = false;
        assert_eq!(
            kinds_at(&observe(&[relied_on_sound_source]), 21),
            vec![BiasKind::BlameShift]
        );

        // Near-miss that still counts: the source was corrected, but he never
        // relied on it for this decision.
        let mut corrected_but_unused = quiet_session(22);
        corrected_but_unused.loss_recognized = true;
        corrected_but_unused.public_attribution =
            Some(AttributionTarget::ExternalSource(MOMENTUM));
        corrected_but_unused.attribution_target_in_decision_refs = false;
        corrected_but_unused.attribution_target_was_corrected = true;
        assert_eq!(
            kinds_at(&observe(&[corrected_but_unused]), 22),
            vec![BiasKind::BlameShift]
        );
    }

    #[test]
    fn blame_is_not_shifting_when_the_source_he_relied_on_was_corrected_as_wrong() {
        // Counter-example (character-story-engine.md 「對方確實提供錯誤資訊時，
        // 追究責任不能被標成甩鍋」): the early-move signal is in the losing
        // decision's refs AND the issuer later corrected it. Holding it
        // responsible is a legitimate complaint.
        let mut honest_complaint = quiet_session(20);
        honest_complaint.loss_recognized = true;
        honest_complaint.public_attribution = Some(AttributionTarget::ExternalSource(MOMENTUM));
        honest_complaint.attribution_target_in_decision_refs = true;
        honest_complaint.attribution_target_was_corrected = true;
        let observed = observe(std::slice::from_ref(&honest_complaint));
        assert_eq!(recurrence_count(&observed, BiasKind::BlameShift), 0);
        assert!(kinds_at(&observed, 20).is_empty());
    }

    #[test]
    fn blame_is_not_observed_when_he_names_himself() {
        let mut owns_it = named_colleague_after_loss(20);
        owns_it.public_attribution = Some(AttributionTarget::SelfOwn);
        assert!(kinds_at(&observe(std::slice::from_ref(&owns_it)), 20).is_empty());

        // And saying nothing at all is not blame either.
        let mut silent = named_colleague_after_loss(20);
        silent.public_attribution = None;
        assert!(kinds_at(&observe(std::slice::from_ref(&silent)), 20).is_empty());
    }

    #[test]
    fn blame_is_not_observed_without_a_recognized_loss() {
        let mut no_loss = named_colleague_after_loss(20);
        no_loss.loss_recognized = false;
        assert!(kinds_at(&observe(std::slice::from_ref(&no_loss)), 20).is_empty());
    }

    #[test]
    fn blame_shift_does_not_recur_once_pressure_is_released() {
        // Pressure released: a later session brings another recognized loss,
        // and this time he names himself. Exactly one observation, on the
        // earlier session, and none on the later one.
        let blamed = named_colleague_after_loss(20);
        let mut recovered = quiet_session(26);
        recovered.loss_recognized = true;
        recovered.public_attribution = Some(AttributionTarget::SelfOwn);
        let observed = observe(&[blamed, recovered]);
        assert_eq!(recurrence_count(&observed, BiasKind::BlameShift), 1);
        assert_eq!(kinds_at(&observed, 20), vec![BiasKind::BlameShift]);
        assert!(kinds_at(&observed, 26).is_empty());
    }

    /// A chapter may only claim recurrence on the strength of sessions that
    /// had already closed when it was written. With the counter-evidence
    /// unread across sessions 2, 3 and 4, that makes the claim available from
    /// session 4 onward and never earlier.
    #[test]
    fn recurrence_is_claimable_only_from_two_prior_occurrences_onward() {
        let mut sessions = Vec::new();
        for session_index in 2..=4 {
            let mut session = quiet_session(session_index);
            session.missed_fact_ids = vec![COUNTER];
            sessions.push(session);
        }
        let observed = observe(&sessions);
        assert!(!is_recurring_at(&observed, BiasKind::ConfirmationBias, 2));
        assert!(!is_recurring_at(&observed, BiasKind::ConfirmationBias, 3));
        assert!(is_recurring_at(&observed, BiasKind::ConfirmationBias, 4));
        assert!(is_recurring_at(&observed, BiasKind::ConfirmationBias, 5));
        assert_eq!(
            recurrence_count_before(&observed, BiasKind::ConfirmationBias, 4),
            2
        );
        assert_eq!(
            recurrence_count_before(&observed, BiasKind::ConfirmationBias, 5),
            3
        );
    }

    #[test]
    fn observations_are_deterministic_and_ordered_by_session() {
        let mut trigger = quiet_session(1);
        trigger.missed_high_salience_count = 1;
        trigger.missed_fact_ids = vec![MOMENTUM];
        trigger.fomo_bp_after = 4_600;
        let mut buy = quiet_session(2);
        buy.action = ActionKind::PaperBuy;
        buy.missed_fact_ids = vec![COUNTER];
        let mut hold = quiet_session(3);
        hold.missed_fact_ids = vec![COUNTER];
        let sessions = vec![trigger, buy, hold];
        let first = observe(&sessions);
        let second = observe(&sessions);
        assert_eq!(first, second);
        let order: Vec<usize> = first
            .iter()
            .map(|observation| observation.session_index)
            .collect();
        let mut sorted = order.clone();
        sorted.sort_unstable();
        assert_eq!(order, sorted);
    }
}
