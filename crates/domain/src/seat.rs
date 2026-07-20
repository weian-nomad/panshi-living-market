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

    /// Hashes the complete canonical layout shared by every transport.
    ///
    /// The preimage is the NUL-terminated domain tag followed by five records
    /// in fixed seat order. Each record is `seat_u8` (1 through 5), the raw
    /// 16-byte character UUID, and the raw 16-byte dossier UUID.
    #[must_use]
    pub fn layout_digest(&self) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(b"PSZS/SEAT_PLAN_LAYOUT/v1\0");
        for placement in &self.placements {
            hasher.update([placement.seat_id as u8 + 1]);
            hasher.update(placement.character_id.0);
            hasher.update(placement.dossier_id.0);
        }
        hasher.finalize().into()
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

    #[test]
    fn layout_digest_is_order_independent_after_canonicalization() {
        let canonical = SeatPlan::new([
            placement(SeatId::Gatekeeper, 1),
            placement(SeatId::CoreA, 2),
            placement(SeatId::CoreB, 3),
            placement(SeatId::Flank, 4),
            placement(SeatId::Explore, 5),
        ])
        .expect("canonical plan");
        let shuffled = SeatPlan::new([
            placement(SeatId::Explore, 5),
            placement(SeatId::CoreB, 3),
            placement(SeatId::Gatekeeper, 1),
            placement(SeatId::Flank, 4),
            placement(SeatId::CoreA, 2),
        ])
        .expect("shuffled plan");

        assert_eq!(canonical.layout_digest(), shuffled.layout_digest());
        assert_eq!(
            canonical.layout_digest(),
            [
                0x8a, 0x44, 0xac, 0x0b, 0x54, 0x04, 0x37, 0xb1, 0xc1, 0xa6, 0x8c, 0x70, 0x39,
                0xe8, 0xe4, 0xa1, 0xf9, 0x70, 0x0b, 0xcb, 0x4a, 0xd2, 0xb3, 0x89, 0x40, 0xbf,
                0xec, 0x50, 0x6d, 0xd5, 0x89, 0x33,
            ]
        );
    }
}
use sha2::{Digest, Sha256};
