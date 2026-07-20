use crate::round_desk::{AggregateId, Digest, EventId, SealedSeatPlan};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DecisionSessionState {
    Open,
    InputSealed,
    ActionCommitted,
    OutcomePending,
    SettlementCommitted,
    CausalityClosed,
    VoidCommitted,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DecisionInputRef {
    pub decision_session_id: AggregateId,
    pub round_id: AggregateId,
    pub content_session_id: AggregateId,
    pub logical_cell_id: AggregateId,
    pub ownership_epoch: u64,
    pub decision_input_sealed_event_id: EventId,
    pub decision_session_version: u64,
    pub input_digest: Digest,
    pub snapshot_digest: Digest,
    pub seat_plan_sealed_event_id: EventId,
    pub round_desk_version: u64,
    pub layout_digest: Digest,
    pub kernel_abi_digest: Digest,
    pub algorithm_digest: Digest,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ActionBatchRef {
    pub actions_digest: Digest,
    pub actions_event_id: EventId,
    pub stream_version: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ActionCommitInput {
    pub decision_input_sealed_event_id: EventId,
    pub decision_session_input_version: u64,
    pub input_digest: Digest,
    pub snapshot_digest: Digest,
    pub kernel_abi_digest: Digest,
    pub algorithm_digest: Digest,
    pub actions_digest: Digest,
    pub event_id: EventId,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DecisionSession {
    pub decision_session_id: AggregateId,
    pub round_id: AggregateId,
    pub logical_cell_id: AggregateId,
    pub ownership_epoch: u64,
    pub state: DecisionSessionState,
    pub stream_version: u64,
    pub input: Option<DecisionInputRef>,
    pub actions: Option<ActionBatchRef>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DecisionSessionError {
    WrongState,
    VersionConflict { expected: u64, actual: u64 },
    RoundDeskPreconditionMismatch,
    SealedInputBindingMismatch,
    InputDigestMismatch,
    SnapshotDigestMismatch,
    KernelAbiDigestMismatch,
    AlgorithmDigestMismatch,
    AlreadyCommitted,
    MissingSealedInput,
}

impl DecisionSession {
    #[must_use]
    pub const fn open(
        decision_session_id: AggregateId,
        round_id: AggregateId,
        logical_cell_id: AggregateId,
        ownership_epoch: u64,
        stream_version: u64,
    ) -> Self {
        Self {
            decision_session_id,
            round_id,
            logical_cell_id,
            ownership_epoch,
            state: DecisionSessionState::Open,
            stream_version,
            input: None,
            actions: None,
        }
    }

    /// Freezes the immutable input only when it precisely references the latest
    /// committed `RoundDesk` seal.
    ///
    /// # Errors
    ///
    /// Rejects stale session versions, non-open sessions, or any mismatch in
    /// seal event ID, `RoundDesk` version, and layout digest.
    pub fn seal_input(
        &mut self,
        expected_version: u64,
        sealed_plan: SealedSeatPlan,
        input: DecisionInputRef,
    ) -> Result<DecisionInputRef, DecisionSessionError> {
        self.require_state_and_version(DecisionSessionState::Open, expected_version)?;
        if input.decision_session_id != self.decision_session_id
            || input.round_id != self.round_id
            || input.round_id != sealed_plan.round_id
            || input.content_session_id != sealed_plan.content_session_id
            || input.logical_cell_id != self.logical_cell_id
            || input.logical_cell_id != sealed_plan.logical_cell_id
            || input.ownership_epoch != self.ownership_epoch
            || input.ownership_epoch != sealed_plan.ownership_epoch
            || input.decision_session_version != self.stream_version + 1
            || input.seat_plan_sealed_event_id != sealed_plan.sealed_event_id
            || input.round_desk_version != sealed_plan.stream_version
            || input.layout_digest != sealed_plan.layout_digest
        {
            return Err(DecisionSessionError::RoundDeskPreconditionMismatch);
        }

        self.stream_version += 1;
        self.state = DecisionSessionState::InputSealed;
        self.input = Some(input);
        Ok(input)
    }

    /// Commits a single five-seat action batch for the sealed snapshot and
    /// algorithm.
    ///
    /// # Errors
    ///
    /// Rejects a stale version, wrong state, a second commit, or a runner result
    /// that does not match the sealed snapshot and algorithm digests.
    pub fn commit_actions(
        &mut self,
        expected_version: u64,
        commit: ActionCommitInput,
    ) -> Result<ActionBatchRef, DecisionSessionError> {
        self.require_state_and_version(DecisionSessionState::InputSealed, expected_version)?;
        if self.actions.is_some() {
            return Err(DecisionSessionError::AlreadyCommitted);
        }
        let input = self.input.ok_or(DecisionSessionError::MissingSealedInput)?;
        if input.decision_input_sealed_event_id != commit.decision_input_sealed_event_id
            || input.decision_session_version != commit.decision_session_input_version
        {
            return Err(DecisionSessionError::SealedInputBindingMismatch);
        }
        if input.input_digest != commit.input_digest {
            return Err(DecisionSessionError::InputDigestMismatch);
        }
        if input.snapshot_digest != commit.snapshot_digest {
            return Err(DecisionSessionError::SnapshotDigestMismatch);
        }
        if input.kernel_abi_digest != commit.kernel_abi_digest {
            return Err(DecisionSessionError::KernelAbiDigestMismatch);
        }
        if input.algorithm_digest != commit.algorithm_digest {
            return Err(DecisionSessionError::AlgorithmDigestMismatch);
        }

        self.stream_version += 1;
        self.state = DecisionSessionState::ActionCommitted;
        let actions = ActionBatchRef {
            actions_digest: commit.actions_digest,
            actions_event_id: commit.event_id,
            stream_version: self.stream_version,
        };
        self.actions = Some(actions);
        Ok(actions)
    }

    fn require_state_and_version(
        &self,
        required: DecisionSessionState,
        expected_version: u64,
    ) -> Result<(), DecisionSessionError> {
        if self.state != required {
            return Err(DecisionSessionError::WrongState);
        }
        if self.stream_version != expected_version {
            return Err(DecisionSessionError::VersionConflict {
                expected: expected_version,
                actual: self.stream_version,
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{ActionCommitInput, DecisionInputRef, DecisionSession, DecisionSessionError};
    use crate::round_desk::SealedSeatPlan;

    fn sealed_plan() -> SealedSeatPlan {
        SealedSeatPlan {
            round_id: [2; 16],
            content_session_id: [3; 16],
            logical_cell_id: [12; 16],
            ownership_epoch: 4,
            layout_digest: [4; 32],
            sealed_event_id: [5; 16],
            stream_version: 9,
            database_committed_at_unix_micros: 1_000,
        }
    }

    fn input_ref() -> DecisionInputRef {
        DecisionInputRef {
            decision_session_id: [1; 16],
            round_id: [2; 16],
            content_session_id: [3; 16],
            logical_cell_id: [12; 16],
            ownership_epoch: 4,
            decision_input_sealed_event_id: [13; 16],
            decision_session_version: 4,
            input_digest: [14; 32],
            snapshot_digest: [6; 32],
            seat_plan_sealed_event_id: [5; 16],
            round_desk_version: 9,
            layout_digest: [4; 32],
            kernel_abi_digest: [7; 32],
            algorithm_digest: [8; 32],
        }
    }

    fn action_commit() -> ActionCommitInput {
        ActionCommitInput {
            decision_input_sealed_event_id: [13; 16],
            decision_session_input_version: 4,
            input_digest: [14; 32],
            snapshot_digest: [6; 32],
            kernel_abi_digest: [7; 32],
            algorithm_digest: [8; 32],
            actions_digest: [10; 32],
            event_id: [11; 16],
        }
    }

    #[test]
    fn seal_requires_all_round_desk_preconditions() {
        let mut session = DecisionSession::open([1; 16], [2; 16], [12; 16], 4, 3);
        let mut wrong = input_ref();
        wrong.round_desk_version = 8;
        assert_eq!(
            session.seal_input(3, sealed_plan(), wrong),
            Err(DecisionSessionError::RoundDeskPreconditionMismatch)
        );
        assert_eq!(session.stream_version, 3);

        session
            .seal_input(3, sealed_plan(), input_ref())
            .expect("precise seal reference");
        assert_eq!(session.stream_version, 4);
    }

    #[test]
    fn action_batch_is_bound_to_snapshot_and_algorithm() {
        let mut session = DecisionSession::open([1; 16], [2; 16], [12; 16], 4, 3);
        session
            .seal_input(3, sealed_plan(), input_ref())
            .expect("seal input");

        assert_eq!(
            session.commit_actions(
                4,
                ActionCommitInput {
                    snapshot_digest: [9; 32],
                    ..action_commit()
                }
            ),
            Err(DecisionSessionError::SnapshotDigestMismatch)
        );
        assert_eq!(
            session.commit_actions(
                4,
                ActionCommitInput {
                    kernel_abi_digest: [9; 32],
                    ..action_commit()
                }
            ),
            Err(DecisionSessionError::KernelAbiDigestMismatch)
        );
        assert_eq!(
            session.commit_actions(
                4,
                ActionCommitInput {
                    algorithm_digest: [9; 32],
                    ..action_commit()
                }
            ),
            Err(DecisionSessionError::AlgorithmDigestMismatch)
        );
        let committed = session
            .commit_actions(4, action_commit())
            .expect("commit actions");
        assert_eq!(committed.stream_version, 5);
    }

    #[test]
    fn action_batch_rejects_a_stale_sealed_event_or_session_version() {
        let mut session = DecisionSession::open([1; 16], [2; 16], [12; 16], 4, 3);
        session
            .seal_input(3, sealed_plan(), input_ref())
            .expect("seal input");

        assert_eq!(
            session.commit_actions(
                4,
                ActionCommitInput {
                    decision_input_sealed_event_id: [99; 16],
                    ..action_commit()
                }
            ),
            Err(DecisionSessionError::SealedInputBindingMismatch)
        );
        assert_eq!(
            session.commit_actions(
                4,
                ActionCommitInput {
                    input_digest: [98; 32],
                    ..action_commit()
                }
            ),
            Err(DecisionSessionError::InputDigestMismatch)
        );
        assert_eq!(
            session.commit_actions(
                4,
                ActionCommitInput {
                    decision_session_input_version: 3,
                    ..action_commit()
                }
            ),
            Err(DecisionSessionError::SealedInputBindingMismatch)
        );
        assert_eq!(session.stream_version, 4);
        assert!(session.actions.is_none());
    }
}
