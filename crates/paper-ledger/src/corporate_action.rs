//! `PaperCorporateActionApplied` effects and their accounting corrections
//! (`docs/v5/character-story-engine.md` "Corporate action 與 correction 也遵守
//! 相同 owner 分工"). `PaperPosition` owns the lot/quantity/cost-basis effect;
//! `PaperAccount` only receives the balanced journal batch returned here.
//!
//! Covered:
//!
//! - **Cash dividend** ([`cash_dividend_postings`]): `Cash +net`,
//!   `TaxExpense +withholding`, `CorporateAction -gross`. Withholding is an
//!   optional basis-point fixture parameter (`0` = none).
//! - **Share multiplier** ([`PaperPosition::apply_share_multiplier`]): a
//!   split (ratio 2), a reverse split (ratio 0.5), or a stock dividend
//!   (配股, e.g. ratio 1.1). Every lot is adjusted one by one; quantity is
//!   multiplied by the `Fixed` ratio and per-unit cost is scaled inversely.
//! - **Correction** ([`PaperPosition::reverse_share_adjustment`] and
//!   [`reversal_batch`]): a wrong dividend or share multiplier is undone by an
//!   additional balanced batch and a new position event, never by editing an
//!   earlier batch.
//!
//! Share-multiplier rounding, stated once and applied to every lot:
//!
//! 1. Lots must hold whole shares (raw quantity divisible by
//!    `Fixed::SCALE`); otherwise the action fails closed. Whole-share lots make
//!    every `quantity * price` product exact on the six-decimal grid.
//! 2. `exact = quantity * ratio`; `whole = floor(exact)` shares stay in the
//!    lot; the fractional share `exact - whole` is settled as cash in lieu at
//!    the caller-supplied `cash_in_lieu_price` (truncated at 0.000001).
//! 3. The lot's cost `C = quantity * cost_basis` is split into
//!    `retained = floor(C * whole / exact)` (on raw units) and
//!    `fractional_cost = C - retained`, so `retained + fractional_cost = C`
//!    exactly.
//! 4. `retained` is carried by `whole` shares at `floor(retained / whole)`
//!    per share, plus a rounding tranche of `retained mod whole` shares at one
//!    raw unit (0.000001) more per share. The tranche shares the parent lot's
//!    `lot_id` and `opened_at_unix_micros` (it is the same acquisition) and
//!    sits right after it in FIFO order. Hence the lot's retained cost basis
//!    is exactly `retained` -- nothing is created or lost to per-share
//!    rounding.
//! 5. The journal batch is `Cash +cash_in_lieu`, `Position -fractional_cost`,
//!    `RealizedPnl -(cash_in_lieu - fractional_cost)`, so the cost removed
//!    from the position equals the cost that leaves the journal's position
//!    account and any gain or loss on the fractional share is realized.
//!
//! Deliberately out of scope: real tax-law detail (dividend tax brackets,
//! supplementary health premium, tax credits), rights issues, spin-offs,
//! cash-and-stock elections, and ex-date/pay-date separation (the dividend is
//! credited when the caller applies it).

use panshi_decision_kernel::{Fixed, FixedError};

use crate::account::{JournalEntryKind, JournalPosting};
use crate::execution::{ExecutionError, basis_points_of};
use crate::position::{Lot, MAX_LOTS, PaperPosition, PaperPositionState};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CorporateActionError {
    /// A non-positive share ratio.
    InvalidRatio,
    /// A non-positive held quantity or per-share dividend, or a negative
    /// cash-in-lieu price.
    InvalidAmount,
    /// A withholding rate outside `0..=10_000` basis points.
    InvalidRate,
    /// A lot holds a fractional share; see the module rounding rule 1.
    FractionalLotQuantity,
    /// The rounding tranches would not fit in the lot table. The position is
    /// left unchanged.
    LotTableFull,
    PositionClosed,
    VersionConflict {
        expected: u64,
        actual: u64,
    },
    /// The position changed after the action being corrected, so an exact
    /// reversal is not possible; the correction fails closed.
    CorrectionBaseMismatch,
    Fixed(FixedError),
}

impl From<FixedError> for CorporateActionError {
    fn from(error: FixedError) -> Self {
        Self::Fixed(error)
    }
}

impl From<ExecutionError> for CorporateActionError {
    fn from(error: ExecutionError) -> Self {
        match error {
            ExecutionError::InvalidRate => Self::InvalidRate,
            ExecutionError::Fixed(inner) => Self::Fixed(inner),
            _ => Self::InvalidAmount,
        }
    }
}

/// The balanced batch that negates `batch`, posting by posting. Posting it
/// after `batch` nets every account back to where it was; both batches stay
/// in history.
///
/// # Errors
///
/// Fails closed on overflow.
pub fn reversal_batch<const N: usize>(
    batch: &[JournalPosting; N],
) -> Result<[JournalPosting; N], FixedError> {
    let mut reversed = *batch;
    for posting in &mut reversed {
        posting.amount = posting.amount.checked_mul(Fixed::NEG_ONE)?;
    }
    Ok(reversed)
}

/// A cash dividend on `held_quantity` shares.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CashDividendPostings {
    pub gross: Fixed,
    pub withholding_tax: Fixed,
    pub net: Fixed,
    pub postings: [JournalPosting; 3],
}

/// `gross = held_quantity * dividend_per_share` (truncated at 0.000001),
/// `withholding_tax = gross * withholding_tax_bp / 10_000` (truncated), and
/// `net = gross - withholding_tax`.
///
/// # Errors
///
/// Rejects a non-positive quantity or dividend, an invalid rate, or an
/// overflow.
pub fn cash_dividend_postings(
    held_quantity: Fixed,
    dividend_per_share: Fixed,
    withholding_tax_bp: i32,
) -> Result<CashDividendPostings, CorporateActionError> {
    if held_quantity <= Fixed::ZERO || dividend_per_share <= Fixed::ZERO {
        return Err(CorporateActionError::InvalidAmount);
    }
    let gross = held_quantity.checked_mul(dividend_per_share)?;
    let withholding_tax = basis_points_of(gross, withholding_tax_bp)?;
    let net = gross.checked_sub(withholding_tax)?;
    Ok(CashDividendPostings {
        gross,
        withholding_tax,
        net,
        postings: [
            JournalPosting {
                kind: JournalEntryKind::Cash,
                amount: net,
            },
            JournalPosting {
                kind: JournalEntryKind::TaxExpense,
                amount: withholding_tax,
            },
            JournalPosting {
                kind: JournalEntryKind::CorporateAction,
                amount: gross.checked_mul(Fixed::NEG_ONE)?,
            },
        ],
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct LotTable {
    lots: [Option<Lot>; MAX_LOTS],
    lot_count: usize,
    state: PaperPositionState,
}

impl LotTable {
    const fn of(position: &PaperPosition) -> Self {
        Self {
            lots: position.lots,
            lot_count: position.lot_count,
            state: position.state,
        }
    }
}

/// The outcome of one share multiplier. The before/after lot snapshots are
/// private so a record cannot be forged to restore arbitrary lots; the only
/// thing a caller can do with it is post `postings` and, later, correct it
/// with [`PaperPosition::reverse_share_adjustment`].
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ShareAdjustment {
    pub ratio: Fixed,
    pub cash_in_lieu_price: Fixed,
    pub quantity_before: Fixed,
    pub quantity_after: Fixed,
    pub fractional_quantity: Fixed,
    pub cost_basis_before: Fixed,
    pub cost_basis_after: Fixed,
    pub fractional_cost_removed: Fixed,
    pub cash_in_lieu: Fixed,
    pub realized_on_cash_in_lieu: Fixed,
    /// `Cash +cash_in_lieu`, `Position -fractional_cost_removed`,
    /// `RealizedPnl -realized_on_cash_in_lieu`.
    pub postings: [JournalPosting; 3],
    before: LotTable,
    after: LotTable,
}

fn to_fixed(raw: i128) -> Result<Fixed, FixedError> {
    i64::try_from(raw)
        .map(Fixed::from_raw)
        .map_err(|_| FixedError::Overflow)
}

/// One lot after a share multiplier: up to two tranches (base and
/// rounding), plus the fractional share settled as cash in lieu.
struct ScaledLot {
    tranches: [Option<Lot>; 2],
    fraction: Fixed,
    fractional_cost: Fixed,
    cash_in_lieu: Fixed,
}

/// Applies the module-level rounding rule 1-4 to a single lot.
fn scale_lot(
    lot: &Lot,
    ratio: Fixed,
    cash_in_lieu_price: Fixed,
) -> Result<ScaledLot, CorporateActionError> {
    let scale = i128::from(Fixed::SCALE);
    if i128::from(lot.quantity.raw()) % scale != 0 {
        return Err(CorporateActionError::FractionalLotQuantity);
    }
    let lot_cost = lot.quantity.checked_mul(lot.cost_basis)?;
    let exact_raw = i128::from(lot.quantity.checked_mul(ratio)?.raw());
    let whole_raw = exact_raw - exact_raw % scale;
    let whole_shares = whole_raw / scale;
    let fraction = to_fixed(exact_raw - whole_raw)?;
    let retained_raw = if whole_shares == 0 {
        0
    } else {
        i128::from(lot_cost.raw()) * whole_raw / exact_raw
    };
    let fractional_cost = lot_cost.checked_sub(to_fixed(retained_raw)?)?;
    let cash_in_lieu = fraction.checked_mul(cash_in_lieu_price)?;

    let mut tranches = [None; 2];
    if whole_shares > 0 {
        let per_share_raw = retained_raw / whole_shares;
        let tranche_shares = retained_raw - per_share_raw * whole_shares;
        let base_shares = whole_shares - tranche_shares;
        for (slot, (shares, per_share)) in tranches.iter_mut().zip([
            (base_shares, per_share_raw),
            (tranche_shares, per_share_raw + 1),
        ]) {
            if shares > 0 {
                *slot = Some(Lot {
                    lot_id: lot.lot_id,
                    quantity: to_fixed(shares * scale)?,
                    cost_basis: to_fixed(per_share)?,
                    opened_at_unix_micros: lot.opened_at_unix_micros,
                });
            }
        }
    }
    Ok(ScaledLot {
        tranches,
        fraction,
        fractional_cost,
        cash_in_lieu,
    })
}

impl PaperPosition {
    /// `PaperCorporateActionApplied` for a split, reverse split, or stock
    /// dividend. See the module-level rounding rule. The whole action is
    /// computed on a copy and committed only if every lot succeeds.
    ///
    /// # Errors
    ///
    /// Rejects a stale version, a closed position, a non-positive ratio, a
    /// negative cash-in-lieu price, a fractional-share lot, a full lot
    /// table, or an overflow. On error the position is unchanged.
    pub fn apply_share_multiplier(
        &mut self,
        expected_version: u64,
        ratio: Fixed,
        cash_in_lieu_price: Fixed,
    ) -> Result<ShareAdjustment, CorporateActionError> {
        if self.stream_version != expected_version {
            return Err(CorporateActionError::VersionConflict {
                expected: expected_version,
                actual: self.stream_version,
            });
        }
        if self.state != PaperPositionState::Open {
            return Err(CorporateActionError::PositionClosed);
        }
        if ratio <= Fixed::ZERO {
            return Err(CorporateActionError::InvalidRatio);
        }
        if cash_in_lieu_price < Fixed::ZERO {
            return Err(CorporateActionError::InvalidAmount);
        }

        let before = LotTable::of(self);
        let quantity_before = self.quantity();
        let cost_basis_before = self.total_cost_basis()?;

        let mut next = [None; MAX_LOTS];
        let mut next_count = 0_usize;
        let mut fractional_quantity = Fixed::ZERO;
        let mut fractional_cost = Fixed::ZERO;
        let mut cash_in_lieu = Fixed::ZERO;

        for lot in self.lots() {
            let scaled = scale_lot(lot, ratio, cash_in_lieu_price)?;
            fractional_quantity = fractional_quantity.checked_add(scaled.fraction)?;
            fractional_cost = fractional_cost.checked_add(scaled.fractional_cost)?;
            cash_in_lieu = cash_in_lieu.checked_add(scaled.cash_in_lieu)?;
            for tranche in scaled.tranches.into_iter().flatten() {
                if next_count >= MAX_LOTS {
                    return Err(CorporateActionError::LotTableFull);
                }
                next[next_count] = Some(tranche);
                next_count += 1;
            }
        }

        let realized = cash_in_lieu.checked_sub(fractional_cost)?;
        let realized_pnl = self.realized_pnl.checked_add(realized)?;
        let postings = [
            JournalPosting {
                kind: JournalEntryKind::Cash,
                amount: cash_in_lieu,
            },
            JournalPosting {
                kind: JournalEntryKind::Position,
                amount: fractional_cost.checked_mul(Fixed::NEG_ONE)?,
            },
            JournalPosting {
                kind: JournalEntryKind::RealizedPnl,
                amount: realized.checked_mul(Fixed::NEG_ONE)?,
            },
        ];

        // Commit.
        self.lots = next;
        self.lot_count = next_count;
        self.realized_pnl = realized_pnl;
        if next_count == 0 {
            self.state = PaperPositionState::Closed;
        }
        self.stream_version += 1;

        Ok(ShareAdjustment {
            ratio,
            cash_in_lieu_price,
            quantity_before,
            quantity_after: self.quantity(),
            fractional_quantity,
            cost_basis_before,
            cost_basis_after: self.total_cost_basis()?,
            fractional_cost_removed: fractional_cost,
            cash_in_lieu,
            realized_on_cash_in_lieu: realized,
            postings,
            before,
            after: LotTable::of(self),
        })
    }

    /// `PaperAccountingCorrectionApplied` for a share multiplier applied in
    /// error: a new position event that restores the lots exactly as they
    /// were before `adjustment`, backs its realized P&L out, and returns the
    /// balanced reversal batch for `PaperAccount`. The original event and
    /// batch remain in history. Only valid while the position is still
    /// exactly as `adjustment` left it; anything else fails closed. The
    /// position may be `Closed` here if the erroneous action closed it; the
    /// correction reopens it.
    ///
    /// # Errors
    ///
    /// Rejects a stale version, a position that changed since `adjustment`,
    /// or an overflow. On error the position is unchanged.
    pub fn reverse_share_adjustment(
        &mut self,
        expected_version: u64,
        adjustment: &ShareAdjustment,
    ) -> Result<[JournalPosting; 3], CorporateActionError> {
        if self.stream_version != expected_version {
            return Err(CorporateActionError::VersionConflict {
                expected: expected_version,
                actual: self.stream_version,
            });
        }
        if LotTable::of(self) != adjustment.after {
            return Err(CorporateActionError::CorrectionBaseMismatch);
        }
        let reversal = reversal_batch(&adjustment.postings)?;
        let realized_pnl = self
            .realized_pnl
            .checked_sub(adjustment.realized_on_cash_in_lieu)?;
        self.lots = adjustment.before.lots;
        self.lot_count = adjustment.before.lot_count;
        self.state = adjustment.before.state;
        self.realized_pnl = realized_pnl;
        self.stream_version += 1;
        Ok(reversal)
    }
}

#[cfg(test)]
mod tests {
    use super::{CorporateActionError, cash_dividend_postings, reversal_batch};
    use crate::account::{JournalEntryKind, JournalPosting, PaperAccount, PaperAccountPolicy};
    use crate::position::{Lot, PaperPosition, PaperPositionState};
    use panshi_decision_kernel::Fixed;

    fn units(n: i64) -> Fixed {
        Fixed::from_raw(n * Fixed::SCALE)
    }

    fn sum(postings: &[JournalPosting]) -> Fixed {
        postings
            .iter()
            .fold(Fixed::ZERO, |total, p| total.checked_add(p.amount).unwrap())
    }

    fn lot(id: u8, quantity: i64, cost_basis: Fixed) -> Lot {
        Lot {
            lot_id: [id; 16],
            quantity: units(quantity),
            cost_basis,
            opened_at_unix_micros: i64::from(id),
        }
    }

    fn position_with(lots: &[Lot]) -> PaperPosition {
        let mut position = PaperPosition::open([1; 16], [2; 16], [3; 32], lots[0]);
        for (version, extra) in (0_u64..).zip(&lots[1..]) {
            position.add_lot(version, *extra).unwrap();
        }
        position
    }

    fn funded_account() -> PaperAccount {
        let mut account = PaperAccount::open([1; 16], [2; 16], PaperAccountPolicy::V1);
        account.initialize_cash(0).unwrap();
        account
    }

    #[test]
    fn cash_dividend_credits_cash_against_corporate_action_and_balances() {
        let dividend = cash_dividend_postings(units(1_000), Fixed::from_raw(2_500_000), 0).unwrap();
        assert_eq!(dividend.gross, units(2_500));
        assert_eq!(dividend.withholding_tax, Fixed::ZERO);
        assert_eq!(dividend.net, units(2_500));
        assert_eq!(sum(&dividend.postings), Fixed::ZERO);
        let mut account = funded_account();
        let (before, after) = account.post_journal(1, &dividend.postings).unwrap();
        assert_eq!(after.checked_sub(before).unwrap(), units(2_500));
        assert_eq!(
            cash_dividend_postings(Fixed::ZERO, units(1), 0),
            Err(CorporateActionError::InvalidAmount)
        );
    }

    #[test]
    fn cash_dividend_with_withholding_tax_posts_tax_expense_and_balances() {
        // Fixture withholding rate of 211 bp; illustrative only.
        let dividend =
            cash_dividend_postings(units(1_000), Fixed::from_raw(2_500_000), 211).unwrap();
        // 2,500 * 211 / 10,000 = 52.75.
        assert_eq!(dividend.withholding_tax, Fixed::from_raw(52_750_000));
        assert_eq!(dividend.net, Fixed::from_raw(2_447_250_000));
        assert_eq!(dividend.postings[1].kind, JournalEntryKind::TaxExpense);
        assert_eq!(sum(&dividend.postings), Fixed::ZERO);
    }

    #[test]
    fn split_two_for_one_scales_each_lot_and_conserves_total_cost_basis() {
        let mut position = position_with(&[lot(1, 1_000, units(100)), lot(2, 300, units(120))]);
        let adjustment = position
            .apply_share_multiplier(1, units(2), units(55))
            .unwrap();
        let lots: Vec<Lot> = position.lots().copied().collect();
        assert_eq!(lots.len(), 2);
        assert_eq!(
            (lots[0].quantity, lots[0].cost_basis),
            (units(2_000), units(50))
        );
        assert_eq!(
            (lots[1].quantity, lots[1].cost_basis),
            (units(600), units(60))
        );
        assert_eq!(adjustment.cost_basis_before, units(136_000));
        assert_eq!(adjustment.cost_basis_after, units(136_000));
        assert_eq!(adjustment.fractional_quantity, Fixed::ZERO);
        assert_eq!(adjustment.cash_in_lieu, Fixed::ZERO);
        assert_eq!(sum(&adjustment.postings), Fixed::ZERO);
        assert_eq!(position.stream_version, 2);
    }

    #[test]
    fn split_with_odd_per_share_cost_adds_rounding_tranche_and_conserves_cost() {
        // 3 shares at 100.000001 -> C = 300.000003; a 2:1 split leaves 6
        // shares carrying 300.000003, i.e. 50.0000005 each, which is not on
        // the grid: 3 shares at 50.000000 and 3 at 50.000001.
        let mut position = position_with(&[lot(1, 3, Fixed::from_raw(100_000_001))]);
        let adjustment = position
            .apply_share_multiplier(0, units(2), units(50))
            .unwrap();
        let lots: Vec<Lot> = position.lots().copied().collect();
        assert_eq!(lots.len(), 2);
        assert_eq!(
            (lots[0].quantity, lots[0].cost_basis),
            (units(3), Fixed::from_raw(50_000_000))
        );
        assert_eq!(
            (lots[1].quantity, lots[1].cost_basis),
            (units(3), Fixed::from_raw(50_000_001))
        );
        assert_eq!(lots[1].lot_id, lots[0].lot_id);
        assert_eq!(adjustment.cost_basis_after, adjustment.cost_basis_before);
        assert_eq!(adjustment.fractional_cost_removed, Fixed::ZERO);
    }

    #[test]
    fn stock_dividend_pays_fractional_share_as_cash_in_lieu_and_conserves_value() {
        // 配股 ratio 1.1 on 1,234 shares at 100 -> 1,357.4 shares.
        let mut position = position_with(&[lot(1, 1_234, units(100))]);
        let adjustment = position
            .apply_share_multiplier(0, Fixed::from_raw(1_100_000), units(95))
            .unwrap();
        assert_eq!(adjustment.quantity_after, units(1_357));
        assert_eq!(adjustment.fractional_quantity, Fixed::from_raw(400_000));
        assert_eq!(adjustment.cash_in_lieu, units(38));
        assert_eq!(
            adjustment
                .cost_basis_after
                .checked_add(adjustment.fractional_cost_removed)
                .unwrap(),
            adjustment.cost_basis_before
        );
        assert_eq!(
            adjustment.realized_on_cash_in_lieu,
            adjustment
                .cash_in_lieu
                .checked_sub(adjustment.fractional_cost_removed)
                .unwrap()
        );
        assert_eq!(position.realized_pnl, adjustment.realized_on_cash_in_lieu);
        assert_eq!(sum(&adjustment.postings), Fixed::ZERO);
        let mut account = funded_account();
        account.post_journal(1, &adjustment.postings).unwrap();
    }

    #[test]
    fn reverse_split_below_one_share_closes_the_lot_for_cash_in_lieu() {
        let mut position = position_with(&[lot(1, 3, units(10))]);
        let adjustment = position
            .apply_share_multiplier(0, Fixed::from_raw(250_000), units(40))
            .unwrap();
        assert_eq!(adjustment.quantity_after, Fixed::ZERO);
        assert_eq!(position.state, PaperPositionState::Closed);
        assert_eq!(adjustment.fractional_cost_removed, units(30));
        assert_eq!(adjustment.cash_in_lieu, units(30));
        assert_eq!(sum(&adjustment.postings), Fixed::ZERO);
    }

    #[test]
    fn split_on_full_lot_table_fails_closed_without_mutation() {
        let lots: Vec<Lot> = (0..32)
            .map(|i| lot(i, 3, Fixed::from_raw(100_000_001)))
            .collect();
        let mut position = position_with(&lots);
        let snapshot = position;
        assert_eq!(
            position.apply_share_multiplier(31, units(2), units(50)),
            Err(CorporateActionError::LotTableFull)
        );
        assert_eq!(position, snapshot);
        let mut fractional = position_with(&[Lot {
            quantity: Fixed::from_raw(1_500_000),
            ..lot(1, 1, units(10))
        }]);
        assert_eq!(
            fractional.apply_share_multiplier(0, units(2), units(5)),
            Err(CorporateActionError::FractionalLotQuantity)
        );
        assert_eq!(
            fractional.apply_share_multiplier(0, Fixed::ZERO, units(5)),
            Err(CorporateActionError::InvalidRatio)
        );
    }

    #[test]
    fn correction_of_wrong_cash_dividend_is_an_additional_reversal_batch() {
        let mut account = funded_account();
        let wrong = cash_dividend_postings(units(1_000), units(3), 0).unwrap();
        let (_, after_wrong) = account.post_journal(1, &wrong.postings).unwrap();
        let reversal = reversal_batch(&wrong.postings).unwrap();
        assert_eq!(sum(&reversal), Fixed::ZERO);
        let right = cash_dividend_postings(units(1_000), Fixed::from_raw(2_500_000), 0).unwrap();
        account.post_journal(2, &reversal).unwrap();
        let (_, after_right) = account.post_journal(3, &right.postings).unwrap();
        assert_eq!(after_wrong, units(1_003_000));
        assert_eq!(after_right, units(1_002_500));
        assert_eq!(account.stream_version, 4);
    }

    #[test]
    fn correction_of_wrong_split_restores_lots_and_conserves_after_reapply() {
        let original = [
            lot(1, 1_234, Fixed::from_raw(100_000_001)),
            lot(2, 7, units(90)),
        ];
        let mut position = position_with(&original);
        let untouched = position;
        let mut account = funded_account();
        // Applied 1.1 in error; the real action was a 2:1 split.
        let wrong = position
            .apply_share_multiplier(1, Fixed::from_raw(1_100_000), units(95))
            .unwrap();
        account.post_journal(1, &wrong.postings).unwrap();
        let reversal = position.reverse_share_adjustment(2, &wrong).unwrap();
        assert_eq!(sum(&reversal), Fixed::ZERO);
        account.post_journal(2, &reversal).unwrap();
        assert_eq!(
            position.lots().copied().collect::<Vec<_>>(),
            original.to_vec()
        );
        assert_eq!(position.realized_pnl, untouched.realized_pnl);
        assert_eq!(position.stream_version, 3);
        assert_eq!(account.cash, units(1_000_000));

        let right = position
            .apply_share_multiplier(3, units(2), units(50))
            .unwrap();
        account.post_journal(3, &right.postings).unwrap();
        assert_eq!(right.cost_basis_after, right.cost_basis_before);
        assert_eq!(right.quantity_after, units(2_482));

        // A second reversal of the already-corrected record fails closed.
        assert_eq!(
            position.reverse_share_adjustment(4, &wrong),
            Err(CorporateActionError::CorrectionBaseMismatch)
        );
    }
}
