//! `PaperOrder`: requested terms, submitted／rejected／filled／expired
//! lifecycle, fill refs, execution ruleset, and price-source refs. Does
//! **not** own cash, journal balance, position quantity, cost, or mark
//! (`docs/v5/system-design.md` §9.1).

use panshi_decision_kernel::Fixed;

use crate::Id;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OrderSide {
    Buy,
    Sell,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PaperOrderState {
    Submitted,
    Filled,
    Rejected,
    Expired,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PaperOrderError {
    WrongState,
    VersionConflict { expected: u64, actual: u64 },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PaperOrder {
    pub paper_order_id: Id,
    pub paper_account_id: Id,
    pub security_id_hash: [u8; 32],
    pub side: OrderSide,
    pub quantity: Fixed,
    pub committed_at_unix_micros: i64,
    pub expires_at_unix_micros: i64,
    pub state: PaperOrderState,
    pub stream_version: u64,
}

impl PaperOrder {
    #[must_use]
    pub const fn submit(
        paper_order_id: Id,
        paper_account_id: Id,
        security_id_hash: [u8; 32],
        side: OrderSide,
        quantity: Fixed,
        committed_at_unix_micros: i64,
        expires_at_unix_micros: i64,
    ) -> Self {
        Self {
            paper_order_id,
            paper_account_id,
            security_id_hash,
            side,
            quantity,
            committed_at_unix_micros,
            expires_at_unix_micros,
            state: PaperOrderState::Submitted,
            stream_version: 0,
        }
    }

    /// `PaperOrderFilledV1`. Only the first eligible sealed price *after*
    /// `committed_at_unix_micros` may be used
    /// (`docs/v5/character-story-engine.md` "從想法到成交").
    ///
    /// # Errors
    ///
    /// Rejects a stale version, a non-`Submitted` order, or a price observed
    /// before the order was committed.
    pub fn fill(
        &mut self,
        expected_version: u64,
        price_observed_at_unix_micros: i64,
    ) -> Result<(), PaperOrderError> {
        self.require_state_and_version(PaperOrderState::Submitted, expected_version)?;
        if price_observed_at_unix_micros < self.committed_at_unix_micros {
            return Err(PaperOrderError::WrongState);
        }
        self.state = PaperOrderState::Filled;
        self.stream_version += 1;
        Ok(())
    }

    /// `PaperOrderExpiredV1`: no eligible price arrived before
    /// `expires_at_unix_micros`
    /// (`docs/v5/character-story-engine.md`: "沒有合格價格就
    /// `PaperOrderExpired`；不得在事後挑一個最好看的日內價格").
    ///
    /// # Errors
    ///
    /// Rejects a stale version or a non-`Submitted` order.
    pub fn expire(&mut self, expected_version: u64) -> Result<(), PaperOrderError> {
        self.require_state_and_version(PaperOrderState::Submitted, expected_version)?;
        self.state = PaperOrderState::Expired;
        self.stream_version += 1;
        Ok(())
    }

    /// `PaperOrderRejectedV1`.
    ///
    /// # Errors
    ///
    /// Rejects a stale version or a non-`Submitted` order.
    pub fn reject(&mut self, expected_version: u64) -> Result<(), PaperOrderError> {
        self.require_state_and_version(PaperOrderState::Submitted, expected_version)?;
        self.state = PaperOrderState::Rejected;
        self.stream_version += 1;
        Ok(())
    }

    fn require_state_and_version(
        &self,
        required: PaperOrderState,
        expected_version: u64,
    ) -> Result<(), PaperOrderError> {
        if self.stream_version != expected_version {
            return Err(PaperOrderError::VersionConflict {
                expected: expected_version,
                actual: self.stream_version,
            });
        }
        if self.state != required {
            return Err(PaperOrderError::WrongState);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{OrderSide, PaperOrder, PaperOrderError, PaperOrderState};
    use panshi_decision_kernel::Fixed;

    fn order() -> PaperOrder {
        PaperOrder::submit(
            [1; 16],
            [2; 16],
            [3; 32],
            OrderSide::Buy,
            Fixed::from_raw(1_000 * Fixed::SCALE),
            10_000,
            20_000,
        )
    }

    #[test]
    fn fill_before_commit_time_is_rejected() {
        let mut order = order();
        assert_eq!(
            order.fill(0, 9_999),
            Err(PaperOrderError::WrongState)
        );
        assert_eq!(order.state, PaperOrderState::Submitted);
    }

    #[test]
    fn fill_after_commit_time_succeeds_once() {
        let mut order = order();
        order.fill(0, 10_500).expect("fill");
        assert_eq!(order.state, PaperOrderState::Filled);
        assert_eq!(
            order.fill(1, 10_600),
            Err(PaperOrderError::WrongState)
        );
    }

    #[test]
    fn expire_and_reject_are_terminal() {
        let mut order = order();
        order.expire(0).expect("expire");
        assert_eq!(
            order.reject(1),
            Err(PaperOrderError::WrongState)
        );
    }
}
