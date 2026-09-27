//! Execution-ruleset effects that sit between `PaperOrder`, `PaperPosition`,
//! and `PaperAccount` without owning any of their authoritative fields
//! (`docs/v5/character-story-engine.md` "交易單位、漲跌幅、交易時間、暫停交易、
//! 手續費、稅、公司行動與成交規則來自 `ExecutionRuleset`"):
//!
//! - [`ExecutionCostSchedule`]: buy fee, sell fee, and sell-side transaction
//!   tax as integer basis points. The rates are fixture parameters of an
//!   execution ruleset revision, not a statement of any real tax law.
//! - [`buy_fill_postings`] / [`sell_fill_postings`]: the balanced journal
//!   batch for one fill. Fees are posted as `FeeExpense`, the transaction tax
//!   as `TaxExpense`; every batch sums to exactly zero.
//! - [`TradingStatus`] / [`InstrumentMarket`]: per-instrument trading status
//!   and the last accepted sealed price. A halted instrument never fills and
//!   never accepts a new price.
//! - [`fill_order`]: the only fill path that consults trading status.
//!
//! Rounding rule for every basis-point amount: `amount * bp / 10_000` is
//! computed on the raw six-decimal integer through `i128` and truncated
//! toward zero (amounts are non-negative, so this is a floor at 0.000001).
//! Whatever the rounded amount is, the same amount is posted to cash and to
//! the expense account, so rounding can never create or destroy value.

use panshi_decision_kernel::{Fixed, FixedError};

use crate::account::{JournalEntryKind, JournalPosting};
use crate::order::{PaperOrder, PaperOrderError, PaperOrderState};

/// One whole basis point denominator.
pub const BASIS_POINTS_PER_UNIT: i32 = 10_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExecutionError {
    /// A basis-point rate outside `0..=10_000`.
    InvalidRate,
    /// A negative notional, a non-positive price, or a non-positive quantity.
    InvalidAmount,
    /// The order and the market refer to different instruments.
    SecurityMismatch,
    /// The instrument is halted: no fill and no new price.
    Halted,
    /// The instrument is already in the requested trading status.
    AlreadyInStatus,
    /// The order's lifetime overlapped a halt (it was committed while the
    /// instrument was halted, or a halt began after it was committed). The
    /// order may only expire; a price from after the halt must not complete
    /// it.
    OrderSpannedHalt,
    /// No accepted price exists yet (fail closed: no mark, no fill).
    NoAcceptedPrice,
    /// A corporate action changed the share count after the last accepted
    /// price; the unadjusted price must not be published as a mark.
    MarkStaleAfterCorporateAction,
    /// A price observation that is not strictly later than the last
    /// accepted one.
    StalePrice,
    /// A halt or resume timestamp earlier than the transition it follows.
    StatusTimeRegression,
    /// The only eligible price was observed after the order expired.
    PriceAfterExpiry,
    Order(PaperOrderError),
    Fixed(FixedError),
}

impl From<FixedError> for ExecutionError {
    fn from(error: FixedError) -> Self {
        Self::Fixed(error)
    }
}

impl From<PaperOrderError> for ExecutionError {
    fn from(error: PaperOrderError) -> Self {
        Self::Order(error)
    }
}

/// `amount * bp / 10_000`, truncated toward zero at the six-decimal grid.
///
/// # Errors
///
/// Rejects a negative amount, a rate outside `0..=10_000`, or an overflow.
pub fn basis_points_of(amount: Fixed, bp: i32) -> Result<Fixed, ExecutionError> {
    if !(0..=BASIS_POINTS_PER_UNIT).contains(&bp) {
        return Err(ExecutionError::InvalidRate);
    }
    if amount < Fixed::ZERO {
        return Err(ExecutionError::InvalidAmount);
    }
    let raw = i128::from(amount.raw()) * i128::from(bp) / i128::from(BASIS_POINTS_PER_UNIT);
    i64::try_from(raw)
        .map(Fixed::from_raw)
        .map_err(|_| ExecutionError::Fixed(FixedError::Overflow))
}

/// Fee and tax rates of one execution ruleset revision, in integer basis
/// points. Buy fills pay `buy_fee_bp`; sell fills pay `sell_fee_bp` plus
/// `sell_tax_bp`. There is deliberately no buy-side tax and no minimum fee:
/// both would be additional ruleset fields, not hidden constants.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ExecutionCostSchedule {
    pub buy_fee_bp: i32,
    pub sell_fee_bp: i32,
    pub sell_tax_bp: i32,
}

impl ExecutionCostSchedule {
    /// # Errors
    ///
    /// Rejects any rate outside `0..=10_000`.
    pub fn validate(&self) -> Result<(), ExecutionError> {
        for bp in [self.buy_fee_bp, self.sell_fee_bp, self.sell_tax_bp] {
            if !(0..=BASIS_POINTS_PER_UNIT).contains(&bp) {
                return Err(ExecutionError::InvalidRate);
            }
        }
        Ok(())
    }
}

/// The balanced batch for one buy fill:
/// `Cash -(notional + fee)`, `Position +notional`, `FeeExpense +fee`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BuyFillPostings {
    pub notional: Fixed,
    pub fee: Fixed,
    pub postings: [JournalPosting; 3],
}

/// # Errors
///
/// Rejects a non-positive price or quantity, an invalid schedule, or an
/// overflow.
pub fn buy_fill_postings(
    price: Fixed,
    quantity: Fixed,
    schedule: &ExecutionCostSchedule,
) -> Result<BuyFillPostings, ExecutionError> {
    schedule.validate()?;
    if price <= Fixed::ZERO || quantity <= Fixed::ZERO {
        return Err(ExecutionError::InvalidAmount);
    }
    let notional = price.checked_mul(quantity)?;
    let fee = basis_points_of(notional, schedule.buy_fee_bp)?;
    let cash_out = notional.checked_add(fee)?.checked_mul(Fixed::NEG_ONE)?;
    Ok(BuyFillPostings {
        notional,
        fee,
        postings: [
            JournalPosting {
                kind: JournalEntryKind::Cash,
                amount: cash_out,
            },
            JournalPosting {
                kind: JournalEntryKind::Position,
                amount: notional,
            },
            JournalPosting {
                kind: JournalEntryKind::FeeExpense,
                amount: fee,
            },
        ],
    })
}

/// The balanced batch for one sell fill:
/// `Cash +(proceeds - fee - tax)`, `Position -cost_removed`,
/// `FeeExpense +fee`, `TaxExpense +tax`, `RealizedPnl -realized`, where
/// `realized` is exactly what `PaperPosition::reduce` returned and
/// `cost_removed = proceeds - realized`. Realized P&L is gross of fee and
/// tax; fee and tax stay visible as their own expense accounts.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SellFillPostings {
    pub proceeds: Fixed,
    pub fee: Fixed,
    pub tax: Fixed,
    pub cost_removed: Fixed,
    pub realized: Fixed,
    pub postings: [JournalPosting; 5],
}

/// # Errors
///
/// Rejects a non-positive price or quantity, an invalid schedule, or an
/// overflow.
pub fn sell_fill_postings(
    price: Fixed,
    quantity: Fixed,
    realized: Fixed,
    schedule: &ExecutionCostSchedule,
) -> Result<SellFillPostings, ExecutionError> {
    schedule.validate()?;
    if price <= Fixed::ZERO || quantity <= Fixed::ZERO {
        return Err(ExecutionError::InvalidAmount);
    }
    let proceeds = price.checked_mul(quantity)?;
    let fee = basis_points_of(proceeds, schedule.sell_fee_bp)?;
    let tax = basis_points_of(proceeds, schedule.sell_tax_bp)?;
    let cost_removed = proceeds.checked_sub(realized)?;
    let cash_in = proceeds.checked_sub(fee)?.checked_sub(tax)?;
    Ok(SellFillPostings {
        proceeds,
        fee,
        tax,
        cost_removed,
        realized,
        postings: [
            JournalPosting {
                kind: JournalEntryKind::Cash,
                amount: cash_in,
            },
            JournalPosting {
                kind: JournalEntryKind::Position,
                amount: cost_removed.checked_mul(Fixed::NEG_ONE)?,
            },
            JournalPosting {
                kind: JournalEntryKind::FeeExpense,
                amount: fee,
            },
            JournalPosting {
                kind: JournalEntryKind::TaxExpense,
                amount: tax,
            },
            JournalPosting {
                kind: JournalEntryKind::RealizedPnl,
                amount: realized.checked_mul(Fixed::NEG_ONE)?,
            },
        ],
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TradingStatus {
    Trading,
    Halted,
}

/// One accepted sealed price observation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AcceptedPrice {
    pub price: Fixed,
    pub observed_at_unix_micros: i64,
}

/// Per-instrument trading status and the last accepted sealed price.
///
/// Halt mark policy (the "keep last accepted source" option, chosen over
/// "refuse to mark"): while [`TradingStatus::Halted`], [`Self::accept_price`]
/// refuses every new observation, so no price is invented or back-filled for
/// the halted window, and [`Self::mark_price`] keeps returning the last price
/// accepted *before* the halt, together with its original observation time
/// so a projection can label it stale. With no accepted price at all, the
/// mark fails closed.
///
/// After a share-count corporate action the last accepted price is on the
/// old share basis. This type does not rebase it (a rebased price would be a
/// derived number, not a sealed fact): [`Self::mark_price`] fails closed with
/// [`ExecutionError::MarkStaleAfterCorporateAction`] until the next accepted
/// price arrives.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InstrumentMarket {
    pub security_id_hash: [u8; 32],
    status: TradingStatus,
    last_accepted: Option<AcceptedPrice>,
    last_halt_started_at_unix_micros: Option<i64>,
    last_resumed_at_unix_micros: Option<i64>,
    mark_stale_after_corporate_action: bool,
}

impl InstrumentMarket {
    #[must_use]
    pub const fn new(security_id_hash: [u8; 32]) -> Self {
        Self {
            security_id_hash,
            status: TradingStatus::Trading,
            last_accepted: None,
            last_halt_started_at_unix_micros: None,
            last_resumed_at_unix_micros: None,
            mark_stale_after_corporate_action: false,
        }
    }

    #[must_use]
    pub const fn status(&self) -> TradingStatus {
        self.status
    }

    /// The last accepted observation, regardless of staleness. Ledger
    /// conservation checks use this; public marks use [`Self::mark_price`].
    #[must_use]
    pub const fn last_accepted(&self) -> Option<AcceptedPrice> {
        self.last_accepted
    }

    #[must_use]
    pub const fn last_halt_started_at_unix_micros(&self) -> Option<i64> {
        self.last_halt_started_at_unix_micros
    }

    #[must_use]
    pub const fn last_resumed_at_unix_micros(&self) -> Option<i64> {
        self.last_resumed_at_unix_micros
    }

    /// # Errors
    ///
    /// Rejects a halt of an already halted instrument, or a halt time
    /// earlier than the last resume.
    pub fn halt(&mut self, at_unix_micros: i64) -> Result<(), ExecutionError> {
        if self.status == TradingStatus::Halted {
            return Err(ExecutionError::AlreadyInStatus);
        }
        if self
            .last_resumed_at_unix_micros
            .is_some_and(|resumed| at_unix_micros < resumed)
        {
            return Err(ExecutionError::StatusTimeRegression);
        }
        self.status = TradingStatus::Halted;
        self.last_halt_started_at_unix_micros = Some(at_unix_micros);
        Ok(())
    }

    /// # Errors
    ///
    /// Rejects a resume of an instrument that is already trading, or a
    /// resume time earlier than the halt it ends.
    pub fn resume(&mut self, at_unix_micros: i64) -> Result<(), ExecutionError> {
        if self.status == TradingStatus::Trading {
            return Err(ExecutionError::AlreadyInStatus);
        }
        if self
            .last_halt_started_at_unix_micros
            .is_some_and(|started| at_unix_micros < started)
        {
            return Err(ExecutionError::StatusTimeRegression);
        }
        self.status = TradingStatus::Trading;
        self.last_resumed_at_unix_micros = Some(at_unix_micros);
        Ok(())
    }

    /// Accepts one sealed price observation.
    ///
    /// # Errors
    ///
    /// Rejects any observation while halted, a non-positive price, and an
    /// observation not strictly later than the last accepted one.
    pub fn accept_price(
        &mut self,
        price: Fixed,
        observed_at_unix_micros: i64,
    ) -> Result<AcceptedPrice, ExecutionError> {
        if self.status == TradingStatus::Halted {
            return Err(ExecutionError::Halted);
        }
        if price <= Fixed::ZERO {
            return Err(ExecutionError::InvalidAmount);
        }
        if self
            .last_accepted
            .is_some_and(|last| observed_at_unix_micros <= last.observed_at_unix_micros)
        {
            return Err(ExecutionError::StalePrice);
        }
        let accepted = AcceptedPrice {
            price,
            observed_at_unix_micros,
        };
        self.last_accepted = Some(accepted);
        self.mark_stale_after_corporate_action = false;
        Ok(accepted)
    }

    /// Records that a share-count corporate action took effect; see the
    /// type-level note.
    pub const fn note_share_count_corporate_action(&mut self) {
        self.mark_stale_after_corporate_action = true;
    }

    /// The price a mark may use. During a halt this is the last pre-halt
    /// accepted price (never a new one).
    ///
    /// # Errors
    ///
    /// Fails closed with no accepted price, or after a share-count corporate
    /// action until a new price is accepted.
    pub fn mark_price(&self) -> Result<AcceptedPrice, ExecutionError> {
        if self.mark_stale_after_corporate_action {
            return Err(ExecutionError::MarkStaleAfterCorporateAction);
        }
        self.last_accepted.ok_or(ExecutionError::NoAcceptedPrice)
    }
}

/// Fills `order` against the market's last accepted price, enforcing the
/// trading-status rules before delegating to `PaperOrder::fill`:
///
/// - a halted instrument never fills;
/// - an order whose lifetime overlaps a halt never fills, even after the
///   instrument resumes -- it waits for `PaperOrder::expire`. Overlap means
///   the last halt ended (resumed) at or after the commit, which covers both
///   an order committed during the halt and a halt that began after the
///   commit. Earlier halts ended before the last one began, so the last
///   halt window is sufficient;
/// - the price must be observed at or after commit and at or before expiry.
///
/// On any rejection the order is left unchanged, so it can still expire.
///
/// # Errors
///
/// See [`ExecutionError`].
pub fn fill_order(
    order: &mut PaperOrder,
    expected_version: u64,
    market: &InstrumentMarket,
) -> Result<AcceptedPrice, ExecutionError> {
    if order.security_id_hash != market.security_id_hash {
        return Err(ExecutionError::SecurityMismatch);
    }
    if order.state != PaperOrderState::Submitted {
        return Err(ExecutionError::Order(PaperOrderError::WrongState));
    }
    if market.status == TradingStatus::Halted {
        return Err(ExecutionError::Halted);
    }
    // Trading now, so any recorded halt has a resume time, and `resume`
    // guarantees resume >= halt start: the halt window overlapped the
    // order's lifetime exactly when it ended at or after the commit.
    if market
        .last_resumed_at_unix_micros
        .is_some_and(|resumed| resumed >= order.committed_at_unix_micros)
    {
        return Err(ExecutionError::OrderSpannedHalt);
    }
    let accepted = market
        .last_accepted
        .ok_or(ExecutionError::NoAcceptedPrice)?;
    if accepted.observed_at_unix_micros > order.expires_at_unix_micros {
        return Err(ExecutionError::PriceAfterExpiry);
    }
    order.fill(expected_version, accepted.observed_at_unix_micros)?;
    Ok(accepted)
}

#[cfg(test)]
mod tests {
    use super::{
        ExecutionCostSchedule, ExecutionError, InstrumentMarket, TradingStatus, basis_points_of,
        buy_fill_postings, fill_order, sell_fill_postings,
    };
    use crate::account::{JournalEntryKind, JournalPosting, PaperAccount, PaperAccountPolicy};
    use crate::order::{OrderSide, PaperOrder, PaperOrderError, PaperOrderState};
    use crate::position::{Lot, PaperPosition};
    use panshi_decision_kernel::Fixed;

    /// Fixture ruleset: 14 bp fee each side, 30 bp sell-side transaction
    /// tax. Illustrative fixture parameters only, not a tax-law statement.
    const FIXTURE_SCHEDULE: ExecutionCostSchedule = ExecutionCostSchedule {
        buy_fee_bp: 14,
        sell_fee_bp: 14,
        sell_tax_bp: 30,
    };

    const SECURITY: [u8; 32] = [7; 32];

    fn units(n: i64) -> Fixed {
        Fixed::from_raw(n * Fixed::SCALE)
    }

    fn sum(postings: &[JournalPosting]) -> Fixed {
        postings
            .iter()
            .fold(Fixed::ZERO, |total, p| total.checked_add(p.amount).unwrap())
    }

    fn amount_of(postings: &[JournalPosting], kind: JournalEntryKind) -> Fixed {
        postings
            .iter()
            .filter(|p| p.kind == kind)
            .fold(Fixed::ZERO, |total, p| total.checked_add(p.amount).unwrap())
    }

    fn order(committed: i64, expires: i64) -> PaperOrder {
        PaperOrder::submit(
            [1; 16],
            [2; 16],
            SECURITY,
            OrderSide::Buy,
            units(100),
            committed,
            expires,
        )
    }

    #[test]
    fn buy_fee_is_posted_as_fee_expense_and_batch_balances() {
        let buy = buy_fill_postings(units(250), units(1_000), &FIXTURE_SCHEDULE).unwrap();
        assert_eq!(buy.notional, units(250_000));
        // 250,000 * 14 / 10,000 = 350.
        assert_eq!(buy.fee, units(350));
        assert_eq!(sum(&buy.postings), Fixed::ZERO);
        assert_eq!(
            amount_of(&buy.postings, JournalEntryKind::FeeExpense),
            units(350)
        );
        assert_eq!(
            amount_of(&buy.postings, JournalEntryKind::TaxExpense),
            Fixed::ZERO
        );

        let mut account = PaperAccount::open([1; 16], [2; 16], PaperAccountPolicy::V1);
        account.initialize_cash(0).unwrap();
        let (_, after) = account.post_journal(1, &buy.postings).unwrap();
        assert_eq!(after, units(1_000_000 - 250_350));
    }

    #[test]
    fn sell_fee_and_transaction_tax_are_posted_separately_and_balance() {
        let mut position = PaperPosition::open(
            [1; 16],
            [2; 16],
            SECURITY,
            Lot {
                lot_id: [4; 16],
                quantity: units(1_000),
                cost_basis: units(250),
                opened_at_unix_micros: 1,
            },
        );
        let realized = position.reduce(0, units(400), units(260)).unwrap();
        let sell = sell_fill_postings(units(260), units(400), realized, &FIXTURE_SCHEDULE).unwrap();
        assert_eq!(sell.proceeds, units(104_000));
        // 104,000 * 14 bp = 145.6 ; 104,000 * 30 bp = 312.
        assert_eq!(sell.fee, Fixed::from_raw(145_600_000));
        assert_eq!(sell.tax, units(312));
        assert_eq!(sell.realized, units(4_000));
        assert_eq!(sell.cost_removed, units(100_000));
        assert_eq!(sum(&sell.postings), Fixed::ZERO);
        assert_eq!(
            amount_of(&sell.postings, JournalEntryKind::TaxExpense),
            units(312)
        );
        assert_eq!(
            amount_of(&sell.postings, JournalEntryKind::Cash),
            Fixed::from_raw((104_000 - 312) * Fixed::SCALE - 145_600_000)
        );
    }

    #[test]
    fn tax_rounding_truncates_toward_zero_at_fixed_precision() {
        // 0.000033 * 30 bp = 0.000000099 -> 0 at the six-decimal grid.
        assert_eq!(basis_points_of(Fixed::from_raw(33), 30), Ok(Fixed::ZERO));
        // 1.000033 * 30 bp = 0.003000099 -> 0.003000.
        assert_eq!(
            basis_points_of(Fixed::from_raw(1_000_033), 30),
            Ok(Fixed::from_raw(3_000))
        );
    }

    #[test]
    fn fee_or_tax_rate_outside_basis_point_range_is_rejected() {
        let bad = ExecutionCostSchedule {
            sell_tax_bp: 10_001,
            ..FIXTURE_SCHEDULE
        };
        assert_eq!(
            sell_fill_postings(units(10), units(1), Fixed::ZERO, &bad),
            Err(ExecutionError::InvalidRate)
        );
        assert_eq!(
            basis_points_of(units(10), -1),
            Err(ExecutionError::InvalidRate)
        );
        assert_eq!(
            basis_points_of(units(-10), 5),
            Err(ExecutionError::InvalidAmount)
        );
    }

    #[test]
    fn halt_rejects_fill_and_order_can_only_expire() {
        let mut market = InstrumentMarket::new(SECURITY);
        market.accept_price(units(100), 5).unwrap();
        market.halt(8).unwrap();
        // Order submitted while halted.
        let mut order = order(10, 20);
        assert_eq!(
            fill_order(&mut order, 0, &market),
            Err(ExecutionError::Halted)
        );
        assert_eq!(order.state, PaperOrderState::Submitted);
        assert_eq!(
            market.accept_price(units(101), 12),
            Err(ExecutionError::Halted)
        );
        order.expire(0).unwrap();
        assert_eq!(order.state, PaperOrderState::Expired);
    }

    #[test]
    fn halt_refuses_new_price_and_mark_keeps_last_accepted_price() {
        let mut market = InstrumentMarket::new(SECURITY);
        assert_eq!(market.mark_price(), Err(ExecutionError::NoAcceptedPrice));
        market.accept_price(units(100), 5).unwrap();
        market.halt(6).unwrap();
        assert_eq!(market.status(), TradingStatus::Halted);
        assert_eq!(
            market.accept_price(units(90), 7),
            Err(ExecutionError::Halted)
        );
        let mark = market.mark_price().unwrap();
        assert_eq!(mark.price, units(100));
        assert_eq!(mark.observed_at_unix_micros, 5);
        assert_eq!(market.halt(7), Err(ExecutionError::AlreadyInStatus));
    }

    #[test]
    fn order_spanning_halt_cannot_fill_with_post_resume_price() {
        let mut market = InstrumentMarket::new(SECURITY);
        market.accept_price(units(100), 5).unwrap();
        let mut order = order(10, 40);
        market.halt(15).unwrap();
        market.resume(18).unwrap();
        market.accept_price(units(80), 20).unwrap();
        assert_eq!(
            fill_order(&mut order, 0, &market),
            Err(ExecutionError::OrderSpannedHalt)
        );
        assert_eq!(order.state, PaperOrderState::Submitted);
        order.expire(0).unwrap();

        // A fresh order committed after the resume may fill normally.
        let mut later = self::order(21, 40);
        market.accept_price(units(81), 22).unwrap();
        assert_eq!(fill_order(&mut later, 0, &market).unwrap().price, units(81));
        assert_eq!(
            fill_order(&mut later, 1, &market),
            Err(ExecutionError::Order(PaperOrderError::WrongState))
        );
    }

    #[test]
    fn fill_after_expiry_and_before_commit_are_rejected() {
        let mut market = InstrumentMarket::new(SECURITY);
        market.accept_price(units(100), 5).unwrap();
        let mut early = order(10, 20);
        assert_eq!(
            fill_order(&mut early, 0, &market),
            Err(ExecutionError::Order(PaperOrderError::WrongState))
        );
        market.accept_price(units(100), 25).unwrap();
        assert_eq!(
            fill_order(&mut early, 0, &market),
            Err(ExecutionError::PriceAfterExpiry)
        );
        assert_eq!(early.state, PaperOrderState::Submitted);
        assert_eq!(
            market.accept_price(units(100), 25),
            Err(ExecutionError::StalePrice)
        );
    }
}
