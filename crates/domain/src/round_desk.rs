use crate::seat::SeatPlan;

pub type AggregateId = [u8; 16];
pub type Digest = [u8; 32];
pub type EventId = [u8; 16];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RoundState {
    Draft,
    Ready,
    Open,
    Finalizing,
    Settled,
    Closed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SavedSeatPlan {
    pub plan: SeatPlan,
    pub layout_digest: Digest,
    pub saved_event_id: EventId,
    pub stream_version: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SealedSeatPlan {
    pub round_id: AggregateId,
    pub content_session_id: AggregateId,
    pub logical_cell_id: AggregateId,
    pub ownership_epoch: u64,
    pub layout_digest: Digest,
    pub sealed_event_id: EventId,
    pub stream_version: u64,
    pub database_committed_at_unix_micros: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoundDesk {
    pub round_id: AggregateId,
    pub logical_cell_id: AggregateId,
    pub ownership_epoch: u64,
    pub state: RoundState,
    pub stream_version: u64,
    pub interaction_cutoff_unix_micros: i64,
    pub saved_plan: Option<SavedSeatPlan>,
    pub sealed_plan: Option<SealedSeatPlan>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RoundDeskError {
    WrongState,
    VersionConflict { expected: u64, actual: u64 },
    CutoffPassed,
    CutoffNotReached,
    MissingSeatPlan,
    LayoutDigestMismatch,
    AlreadySealed,
}

impl RoundDesk {
    #[must_use]
    pub const fn open(
        round_id: AggregateId,
        logical_cell_id: AggregateId,
        ownership_epoch: u64,
        stream_version: u64,
        interaction_cutoff_unix_micros: i64,
    ) -> Self {
        Self {
            round_id,
            logical_cell_id,
            ownership_epoch,
            state: RoundState::Open,
            stream_version,
            interaction_cutoff_unix_micros,
            saved_plan: None,
            sealed_plan: None,
        }
    }

    /// Applies one complete atomic seat plan.
    ///
    /// # Errors
    ///
    /// Rejects stale versions, non-open rounds, writes at or after the
    /// authoritative cutoff, and writes after a canonical seal.
    pub fn save_seat_plan(
        &mut self,
        expected_version: u64,
        database_now_unix_micros: i64,
        plan: SeatPlan,
        layout_digest: Digest,
        event_id: EventId,
    ) -> Result<&SavedSeatPlan, RoundDeskError> {
        self.require_open_and_version(expected_version)?;
        if self.sealed_plan.is_some() {
            return Err(RoundDeskError::AlreadySealed);
        }
        if database_now_unix_micros >= self.interaction_cutoff_unix_micros {
            return Err(RoundDeskError::CutoffPassed);
        }

        self.stream_version += 1;
        self.saved_plan = Some(SavedSeatPlan {
            plan,
            layout_digest,
            saved_event_id: event_id,
            stream_version: self.stream_version,
        });
        self.saved_plan
            .as_ref()
            .ok_or(RoundDeskError::MissingSeatPlan)
    }

    /// Seals the exact latest committed layout at or after the authoritative
    /// cutoff.
    ///
    /// # Errors
    ///
    /// Rejects stale versions, a missing plan, early execution, a digest that
    /// does not match the latest committed plan, or a second seal.
    pub fn seal_seat_plan(
        &mut self,
        expected_version: u64,
        database_now_unix_micros: i64,
        content_session_id: AggregateId,
        layout_digest: Digest,
        event_id: EventId,
    ) -> Result<SealedSeatPlan, RoundDeskError> {
        self.require_open_and_version(expected_version)?;
        if self.sealed_plan.is_some() {
            return Err(RoundDeskError::AlreadySealed);
        }
        if database_now_unix_micros < self.interaction_cutoff_unix_micros {
            return Err(RoundDeskError::CutoffNotReached);
        }
        let saved = self
            .saved_plan
            .as_ref()
            .ok_or(RoundDeskError::MissingSeatPlan)?;
        if saved.layout_digest != layout_digest {
            return Err(RoundDeskError::LayoutDigestMismatch);
        }

        self.stream_version += 1;
        let sealed = SealedSeatPlan {
            round_id: self.round_id,
            content_session_id,
            logical_cell_id: self.logical_cell_id,
            ownership_epoch: self.ownership_epoch,
            layout_digest,
            sealed_event_id: event_id,
            stream_version: self.stream_version,
            database_committed_at_unix_micros: database_now_unix_micros,
        };
        self.sealed_plan = Some(sealed);
        Ok(sealed)
    }

    fn require_open_and_version(&self, expected_version: u64) -> Result<(), RoundDeskError> {
        if self.state != RoundState::Open {
            return Err(RoundDeskError::WrongState);
        }
        if self.stream_version != expected_version {
            return Err(RoundDeskError::VersionConflict {
                expected: expected_version,
                actual: self.stream_version,
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{RoundDesk, RoundDeskError};
    use crate::seat::{CharacterId, DossierId, Placement, SeatId, SeatPlan};

    fn plan() -> SeatPlan {
        SeatPlan::new(SeatId::ALL.map(|seat| Placement {
            seat_id: seat,
            character_id: CharacterId([seat as u8 + 1; 16]),
            dossier_id: DossierId([seat as u8 + 11; 16]),
        }))
        .expect("valid plan")
    }

    #[test]
    fn save_then_seal_uses_exact_version_cutoff_and_digest() {
        let mut desk = RoundDesk::open([1; 16], [6; 16], 2, 7, 1_000);
        desk.save_seat_plan(7, 999, plan(), [4; 32], [2; 16])
            .expect("save before cutoff");
        let sealed = desk
            .seal_seat_plan(8, 1_000, [3; 16], [4; 32], [5; 16])
            .expect("seal at cutoff");

        assert_eq!(sealed.stream_version, 9);
        assert_eq!(sealed.sealed_event_id, [5; 16]);
    }

    #[test]
    fn save_at_cutoff_fails_closed() {
        let mut desk = RoundDesk::open([1; 16], [6; 16], 2, 7, 1_000);
        assert_eq!(
            desk.save_seat_plan(7, 1_000, plan(), [4; 32], [2; 16]),
            Err(RoundDeskError::CutoffPassed)
        );
        assert_eq!(desk.stream_version, 7);
    }

    #[test]
    fn early_or_wrong_digest_seal_never_advances_version() {
        let mut desk = RoundDesk::open([1; 16], [6; 16], 2, 7, 1_000);
        desk.save_seat_plan(7, 900, plan(), [4; 32], [2; 16])
            .expect("save");

        assert_eq!(
            desk.seal_seat_plan(8, 999, [3; 16], [4; 32], [5; 16]),
            Err(RoundDeskError::CutoffNotReached)
        );
        assert_eq!(
            desk.seal_seat_plan(8, 1_000, [3; 16], [9; 32], [5; 16]),
            Err(RoundDeskError::LayoutDigestMismatch)
        );
        assert_eq!(desk.stream_version, 8);
    }
}
