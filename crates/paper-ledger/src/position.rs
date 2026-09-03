//! `PaperPosition`: instrument, lots, quantity, cost basis, marks,
//! position-level realized／unrealized P&L, corporate-action effects, and
//! outcome. Does **not** own account cash or journal balance
//! (`docs/v5/system-design.md` §9.1).

use panshi_decision_kernel::{Fixed, FixedError};

use crate::Id;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Lot {
    pub lot_id: Id,
    pub quantity: Fixed,
    pub cost_basis: Fixed, // per unit
    pub opened_at_unix_micros: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PaperPositionState {
    Open,
    Closed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PaperPositionError {
    VersionConflict { expected: u64, actual: u64 },
    PositionClosed,
    InsufficientQuantityToClose,
    Fixed(FixedError),
}

impl From<FixedError> for PaperPositionError {
    fn from(error: FixedError) -> Self {
        Self::Fixed(error)
    }
}

const MAX_LOTS: usize = 32;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PaperPosition {
    pub paper_position_id: Id,
    pub paper_account_id: Id,
    pub security_id_hash: [u8; 32],
    pub state: PaperPositionState,
    pub stream_version: u64,
    lots: [Option<Lot>; MAX_LOTS],
    lot_count: usize,
    pub realized_pnl: Fixed,
    pub unrealized_pnl: Fixed,
}

impl PaperPosition {
    /// `PaperPositionOpenedV1`.
    #[must_use]
    pub const fn open(
        paper_position_id: Id,
        paper_account_id: Id,
        security_id_hash: [u8; 32],
        initial_lot: Lot,
    ) -> Self {
        let mut lots = [None; MAX_LOTS];
        lots[0] = Some(initial_lot);
        Self {
            paper_position_id,
            paper_account_id,
            security_id_hash,
            state: PaperPositionState::Open,
            stream_version: 0,
            lots,
            lot_count: 1,
            realized_pnl: Fixed::ZERO,
            unrealized_pnl: Fixed::ZERO,
        }
    }

    #[must_use]
    pub fn quantity(&self) -> Fixed {
        self.lots[..self.lot_count]
            .iter()
            .flatten()
            .fold(Fixed::ZERO, |total, lot| {
                total.checked_add(lot.quantity).unwrap_or(total)
            })
    }

    /// `PaperPositionAdjustedV1`: adds a new lot (an additional buy fill).
    ///
    /// # Errors
    ///
    /// Rejects a stale version, a closed position, or a full lot table.
    pub fn add_lot(&mut self, expected_version: u64, lot: Lot) -> Result<(), PaperPositionError> {
        self.require_open_and_version(expected_version)?;
        if self.lot_count >= MAX_LOTS {
            return Err(PaperPositionError::InsufficientQuantityToClose);
        }
        self.lots[self.lot_count] = Some(lot);
        self.lot_count += 1;
        self.stream_version += 1;
        Ok(())
    }

    /// `PaperPositionAdjustedV1` or `PaperPositionClosedV1`: reduces the
    /// position FIFO by `quantity_to_close` at `exit_price`, realizing P&L
    /// for the closed quantity. Closes the position entirely (and every
    /// remaining lot is removed) once quantity reaches zero.
    ///
    /// # Errors
    ///
    /// Rejects a stale version, a closed position, or a close quantity that
    /// exceeds the currently held quantity.
    pub fn reduce(
        &mut self,
        expected_version: u64,
        mut quantity_to_close: Fixed,
        exit_price: Fixed,
    ) -> Result<Fixed, PaperPositionError> {
        self.require_open_and_version(expected_version)?;
        if quantity_to_close > self.quantity() {
            return Err(PaperPositionError::InsufficientQuantityToClose);
        }

        let mut realized_delta = Fixed::ZERO;
        for slot in &mut self.lots[..self.lot_count] {
            if quantity_to_close == Fixed::ZERO {
                break;
            }
            let Some(lot) = slot else { continue };
            let closing = if lot.quantity <= quantity_to_close {
                lot.quantity
            } else {
                quantity_to_close
            };
            let gain_per_unit = exit_price.checked_sub(lot.cost_basis)?;
            let lot_realized = gain_per_unit.checked_mul(closing)?;
            realized_delta = realized_delta.checked_add(lot_realized)?;
            quantity_to_close = quantity_to_close.checked_sub(closing)?;
            lot.quantity = lot.quantity.checked_sub(closing)?;
            if lot.quantity == Fixed::ZERO {
                *slot = None;
            }
        }
        self.compact_lots();

        self.realized_pnl = self.realized_pnl.checked_add(realized_delta)?;
        if self.lot_count == 0 {
            self.state = PaperPositionState::Closed;
        }
        self.stream_version += 1;
        Ok(realized_delta)
    }

    /// `PaperMarkAppliedV1`.
    ///
    /// # Errors
    ///
    /// Rejects a stale version.
    pub fn apply_mark(
        &mut self,
        expected_version: u64,
        mark_price: Fixed,
    ) -> Result<Fixed, PaperPositionError> {
        if self.stream_version != expected_version {
            return Err(PaperPositionError::VersionConflict {
                expected: expected_version,
                actual: self.stream_version,
            });
        }
        let mut unrealized = Fixed::ZERO;
        for lot in self.lots[..self.lot_count].iter().flatten() {
            let gain_per_unit = mark_price.checked_sub(lot.cost_basis)?;
            unrealized = unrealized.checked_add(gain_per_unit.checked_mul(lot.quantity)?)?;
        }
        self.unrealized_pnl = unrealized;
        self.stream_version += 1;
        Ok(unrealized)
    }

    fn compact_lots(&mut self) {
        let mut write = 0;
        for read in 0..self.lot_count {
            if let Some(lot) = self.lots[read] {
                self.lots[write] = Some(lot);
                write += 1;
            }
        }
        for slot in &mut self.lots[write..self.lot_count] {
            *slot = None;
        }
        self.lot_count = write;
    }

    fn require_open_and_version(&self, expected_version: u64) -> Result<(), PaperPositionError> {
        if self.stream_version != expected_version {
            return Err(PaperPositionError::VersionConflict {
                expected: expected_version,
                actual: self.stream_version,
            });
        }
        if self.state != PaperPositionState::Open {
            return Err(PaperPositionError::PositionClosed);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{Lot, PaperPosition, PaperPositionError, PaperPositionState};
    use panshi_decision_kernel::Fixed;

    fn opened() -> PaperPosition {
        PaperPosition::open(
            [1; 16],
            [2; 16],
            [3; 32],
            Lot {
                lot_id: [4; 16],
                quantity: Fixed::from_raw(1_000 * Fixed::SCALE),
                cost_basis: Fixed::from_raw(100 * Fixed::SCALE),
                opened_at_unix_micros: 10_000,
            },
        )
    }

    #[test]
    fn quantity_reflects_all_open_lots() {
        let position = opened();
        assert_eq!(position.quantity(), Fixed::from_raw(1_000 * Fixed::SCALE));
    }

    #[test]
    fn reducing_more_than_held_is_rejected() {
        let mut position = opened();
        assert_eq!(
            position.reduce(0, Fixed::from_raw(2_000 * Fixed::SCALE), Fixed::from_raw(110 * Fixed::SCALE)),
            Err(PaperPositionError::InsufficientQuantityToClose)
        );
    }

    #[test]
    fn full_reduction_realizes_pnl_and_closes_the_position() {
        let mut position = opened();
        let realized = position
            .reduce(0, Fixed::from_raw(1_000 * Fixed::SCALE), Fixed::from_raw(110 * Fixed::SCALE))
            .expect("close");
        assert_eq!(realized, Fixed::from_raw(10_000 * Fixed::SCALE));
        assert_eq!(position.state, PaperPositionState::Closed);
        assert_eq!(position.quantity(), Fixed::ZERO);
    }

    /// Golden failure set: partial fill/reduction. A position can be
    /// partially closed (a sell for less than the full held quantity)
    /// without realizing the whole position's P&L or closing it
    /// (`docs/v5/character-story-engine.md` "已實現與未實現損益分開，不能把未成交
    /// 意圖算進績效").
    #[test]
    fn partial_reduction_realizes_only_the_closed_portion_and_stays_open() {
        let mut position = opened();
        let realized = position
            .reduce(0, Fixed::from_raw(400 * Fixed::SCALE), Fixed::from_raw(110 * Fixed::SCALE))
            .expect("partial close");
        assert_eq!(realized, Fixed::from_raw(4_000 * Fixed::SCALE));
        assert_eq!(position.state, PaperPositionState::Open);
        assert_eq!(position.quantity(), Fixed::from_raw(600 * Fixed::SCALE));

        // A second partial reduction against the remaining 600 continues to
        // realize only its own portion and finally closes the position.
        let second_realized = position
            .reduce(1, Fixed::from_raw(600 * Fixed::SCALE), Fixed::from_raw(90 * Fixed::SCALE))
            .expect("second partial closes the remainder");
        assert_eq!(second_realized, Fixed::from_raw(-6_000 * Fixed::SCALE));
        assert_eq!(position.state, PaperPositionState::Closed);
        assert_eq!(position.realized_pnl, Fixed::from_raw(-2_000 * Fixed::SCALE));
    }

    #[test]
    fn mark_reflects_unrealized_gain() {
        let mut position = opened();
        let unrealized = position
            .apply_mark(0, Fixed::from_raw(120 * Fixed::SCALE))
            .expect("mark");
        assert_eq!(unrealized, Fixed::from_raw(20_000 * Fixed::SCALE));
    }
}
