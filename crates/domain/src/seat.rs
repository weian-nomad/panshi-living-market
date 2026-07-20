/// Fixed desk identities. Their order is canonical and also defines the
/// one-pass clockwise peer-message ring.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
#[repr(u8)]
pub enum SeatId {
    Gatekeeper,
    CoreA,
    CoreB,
    Flank,
    Explore,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct CharacterId(pub [u8; 16]);

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct DossierId(pub [u8; 16]);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Placement {
    pub seat_id: SeatId,
    pub character_id: CharacterId,
    pub dossier_id: DossierId,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SeatPlanError {
    DuplicateSeat(SeatId),
    DuplicateCharacter(CharacterId),
    DuplicateDossier(DossierId),
}

/// A complete atomic placement. Construction proves that the five fixed seats,
/// five characters, and five dossiers are all bijective.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SeatPlan {
    placements: [Placement; 5],
}

impl SeatPlan {
    /// Validates and canonicalizes a complete placement by [`SeatId`] order.
    ///
    /// # Errors
    ///
    /// Returns a typed duplicate error when any seat, character, or dossier is
    /// present more than once. Because the payload always has exactly five
    /// entries, proving uniqueness also proves completeness.
    pub fn new(mut placements: [Placement; 5]) -> Result<Self, SeatPlanError> {
        placements.sort_unstable_by_key(|placement| placement.seat_id);

        for right in 1..placements.len() {
            for left in 0..right {
                if placements[left].seat_id == placements[right].seat_id {
                    return Err(SeatPlanError::DuplicateSeat(placements[right].seat_id));
                }
                if placements[left].character_id == placements[right].character_id {
                    return Err(SeatPlanError::DuplicateCharacter(
                        placements[right].character_id,
                    ));
                }
                if placements[left].dossier_id == placements[right].dossier_id {
                    return Err(SeatPlanError::DuplicateDossier(
                        placements[right].dossier_id,
                    ));
                }
            }
        }

        Ok(Self { placements })
    }

    #[must_use]
    pub const fn placements(&self) -> &[Placement; 5] {
        &self.placements
    }

    #[must_use]
    pub fn at(&self, seat_id: SeatId) -> &Placement {
        &self.placements[seat_id as usize]
    }
}

impl SeatId {
    pub const ALL: [Self; 5] = [
        Self::Gatekeeper,
        Self::CoreA,
        Self::CoreB,
        Self::Flank,
        Self::Explore,
    ];

    #[must_use]
    pub const fn right(self) -> Self {
        match self {
            Self::Gatekeeper => Self::CoreA,
            Self::CoreA => Self::CoreB,
            Self::CoreB => Self::Flank,
            Self::Flank => Self::Explore,
            Self::Explore => Self::Gatekeeper,
        }
    }

    #[must_use]
    pub const fn left(self) -> Self {
        match self {
            Self::Gatekeeper => Self::Explore,
            Self::CoreA => Self::Gatekeeper,
            Self::CoreB => Self::CoreA,
            Self::Flank => Self::CoreB,
            Self::Explore => Self::Flank,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{CharacterId, DossierId, Placement, SeatId, SeatPlan, SeatPlanError};

    fn placement(seat_id: SeatId, id: u8) -> Placement {
        Placement {
            seat_id,
            character_id: CharacterId([id; 16]),
            dossier_id: DossierId([id + 10; 16]),
        }
    }

    #[test]
    fn peer_ring_is_closed_and_bidirectional() {
        for seat in SeatId::ALL {
            assert_eq!(seat, seat.right().left());
            assert_eq!(seat, seat.left().right());
        }
    }

    #[test]
    fn atomic_plan_is_canonicalized_by_fixed_seat_order() {
        let plan = SeatPlan::new([
            placement(SeatId::Explore, 5),
            placement(SeatId::CoreB, 3),
            placement(SeatId::Gatekeeper, 1),
            placement(SeatId::Flank, 4),
            placement(SeatId::CoreA, 2),
        ])
        .expect("valid complete plan");

        assert_eq!(plan.placements().map(|item| item.seat_id), SeatId::ALL);
        assert_eq!(plan.at(SeatId::Explore).character_id, CharacterId([5; 16]));
    }

    #[test]
    fn duplicate_character_is_rejected() {
        let mut placements = [
            placement(SeatId::Gatekeeper, 1),
            placement(SeatId::CoreA, 2),
            placement(SeatId::CoreB, 3),
            placement(SeatId::Flank, 4),
            placement(SeatId::Explore, 5),
        ];
        placements[4].character_id = placements[0].character_id;

        assert_eq!(
            SeatPlan::new(placements),
            Err(SeatPlanError::DuplicateCharacter(CharacterId([1; 16])))
        );
    }

    #[test]
    fn duplicate_dossier_is_rejected() {
        let mut placements = [
            placement(SeatId::Gatekeeper, 1),
            placement(SeatId::CoreA, 2),
            placement(SeatId::CoreB, 3),
            placement(SeatId::Flank, 4),
            placement(SeatId::Explore, 5),
        ];
        placements[3].dossier_id = placements[1].dossier_id;

        assert_eq!(
            SeatPlan::new(placements),
            Err(SeatPlanError::DuplicateDossier(DossierId([12; 16])))
        );
    }
}
