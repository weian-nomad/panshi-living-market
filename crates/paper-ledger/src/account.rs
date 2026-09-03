//! `PaperAccount`: currency, cash, reserved cash, double-entry journal
//! postings, account-level balance／risk invariants, and account correction
//! refs. Does **not** own order lifecycle, fill state, lots, quantity, cost
//! basis, or mark (`docs/v5/system-design.md` §9.1).

use panshi_decision_kernel::{Fixed, FixedError};

use crate::Id;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JournalEntryKind {
    Cash,
    Position,
    FeeExpense,
    TaxExpense,
    RealizedPnl,
    CorporateAction,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct JournalPosting {
    pub kind: JournalEntryKind,
    pub amount: Fixed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PaperAccountError {
    WrongVersion { expected: u64, actual: u64 },
    JournalDoesNotBalance,
    InsufficientCash,
    MinimumCashReserveViolated,
    Fixed(FixedError),
}

impl From<FixedError> for PaperAccountError {
    fn from(error: FixedError) -> Self {
        Self::Fixed(error)
    }
}

/// The first-release `PaperAccountPolicy`
/// (`docs/v5/character-story-engine.md` "帳戶與市場規則" /
/// `docs/v5/system-design.md` §9.1): NT$1,000,000 starting cash, at most
/// eight concurrent positions, a single intent may not commit more than 25%
/// of simulated assets, and at least 5% cash must remain after a fill.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PaperAccountPolicy {
    pub initial_cash: Fixed,
    pub max_concurrent_positions: u8,
    pub max_single_position_weight_bp: i32,
    pub min_post_fill_cash_reserve_bp: i32,
}

impl PaperAccountPolicy {
    pub const V1: Self = Self {
        initial_cash: Fixed::from_raw(1_000_000 * Fixed::SCALE),
        max_concurrent_positions: 8,
        max_single_position_weight_bp: 2_500,
        min_post_fill_cash_reserve_bp: 500,
    };
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PaperAccount {
    pub paper_account_id: Id,
    pub character_id: Id,
    pub stream_version: u64,
    pub cash: Fixed,
    pub reserved_cash: Fixed,
    pub policy: PaperAccountPolicy,
}

impl PaperAccount {
    #[must_use]
    pub const fn open(paper_account_id: Id, character_id: Id, policy: PaperAccountPolicy) -> Self {
        Self {
            paper_account_id,
            character_id,
            stream_version: 0,
            cash: Fixed::ZERO,
            reserved_cash: Fixed::ZERO,
            policy,
        }
    }

    /// `PaperCashInitializedV1`.
    ///
    /// # Errors
    ///
    /// Rejects a stale expected version.
    pub fn initialize_cash(&mut self, expected_version: u64) -> Result<(), PaperAccountError> {
        self.require_version(expected_version)?;
        self.cash = self.policy.initial_cash;
        self.stream_version += 1;
        Ok(())
    }

    /// `PaperAccountJournalPostedV1`: applies a balanced batch of postings.
    /// Every double-entry batch in this ledger must sum to exactly zero
    /// (`docs/v5/character-story-engine.md` "Append-only 帳本"). Only
    /// `Cash`-kind postings move `self.cash`; `Position`/`FeeExpense`/
    /// `TaxExpense`/`RealizedPnl`/`CorporateAction` postings are validated
    /// for balance here but their running totals live on `PaperPosition`,
    /// not here.
    ///
    /// # Errors
    ///
    /// Rejects a stale version, an unbalanced posting batch, or a resulting
    /// negative cash balance.
    pub fn post_journal(
        &mut self,
        expected_version: u64,
        postings: &[JournalPosting],
    ) -> Result<(Fixed, Fixed), PaperAccountError> {
        self.require_version(expected_version)?;
        let mut sum = Fixed::ZERO;
        let mut cash_delta = Fixed::ZERO;
        for posting in postings {
            sum = sum.checked_add(posting.amount)?;
            if posting.kind == JournalEntryKind::Cash {
                cash_delta = cash_delta.checked_add(posting.amount)?;
            }
        }
        if sum != Fixed::ZERO {
            return Err(PaperAccountError::JournalDoesNotBalance);
        }
        let cash_before = self.cash;
        let next_cash = self.cash.checked_add(cash_delta)?;
        if next_cash < Fixed::ZERO {
            return Err(PaperAccountError::InsufficientCash);
        }
        self.cash = next_cash;
        self.stream_version += 1;
        Ok((cash_before, self.cash))
    }

    /// Validates the account-level policy gates for a candidate commit
    /// *before* the order is submitted (`docs/v5/character-story-engine.md`
    /// "帳戶與市場規則"): the simulated notional must not exceed 25% of total
    /// assets, and at least 5% cash must remain after the fill.
    ///
    /// # Errors
    ///
    /// Rejects a candidate that would violate either limit.
    pub fn validate_commit(
        &self,
        candidate_notional: Fixed,
        total_assets: Fixed,
        post_fill_cash: Fixed,
    ) -> Result<(), PaperAccountError> {
        let max_weight = Fixed::from_raw(
            i64::from(self.policy.max_single_position_weight_bp) * (Fixed::SCALE / 10_000),
        );
        let max_notional = total_assets.checked_mul(max_weight)?;
        if candidate_notional > max_notional {
            return Err(PaperAccountError::MinimumCashReserveViolated);
        }
        let min_reserve = Fixed::from_raw(
            i64::from(self.policy.min_post_fill_cash_reserve_bp) * (Fixed::SCALE / 10_000),
        );
        let min_cash = total_assets.checked_mul(min_reserve)?;
        if post_fill_cash < min_cash {
            return Err(PaperAccountError::MinimumCashReserveViolated);
        }
        Ok(())
    }

    const fn require_version(&self, expected_version: u64) -> Result<(), PaperAccountError> {
        if self.stream_version != expected_version {
            return Err(PaperAccountError::WrongVersion {
                expected: expected_version,
                actual: self.stream_version,
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{JournalEntryKind, JournalPosting, PaperAccount, PaperAccountError, PaperAccountPolicy};
    use panshi_decision_kernel::Fixed;

    #[test]
    fn unbalanced_postings_are_rejected() {
        let mut account = PaperAccount::open([1; 16], [2; 16], PaperAccountPolicy::V1);
        account.initialize_cash(0).expect("initialize");
        let postings = [JournalPosting {
            kind: JournalEntryKind::Cash,
            amount: Fixed::from_raw(-1_000_000),
        }];
        assert_eq!(
            account.post_journal(1, &postings),
            Err(PaperAccountError::JournalDoesNotBalance)
        );
    }

    #[test]
    fn balanced_buy_fill_moves_cash_and_conserves_the_ledger() {
        let mut account = PaperAccount::open([1; 16], [2; 16], PaperAccountPolicy::V1);
        account.initialize_cash(0).expect("initialize");
        let notional = Fixed::from_raw(100_000 * Fixed::SCALE);
        let fee = Fixed::from_raw(20 * Fixed::SCALE);
        let postings = [
            JournalPosting {
                kind: JournalEntryKind::Cash,
                amount: notional.checked_add(fee).unwrap().checked_mul(Fixed::NEG_ONE).unwrap(),
            },
            JournalPosting {
                kind: JournalEntryKind::Position,
                amount: notional,
            },
            JournalPosting {
                kind: JournalEntryKind::FeeExpense,
                amount: fee,
            },
        ];
        let (before, after) = account.post_journal(1, &postings).expect("balanced fill");
        assert_eq!(before, Fixed::from_raw(1_000_000 * Fixed::SCALE));
        assert_eq!(after, Fixed::from_raw(899_980 * Fixed::SCALE));
    }

    #[test]
    fn cash_cannot_go_negative() {
        let mut account = PaperAccount::open([1; 16], [2; 16], PaperAccountPolicy::V1);
        account.initialize_cash(0).expect("initialize");
        let postings = [
            JournalPosting {
                kind: JournalEntryKind::Cash,
                amount: Fixed::from_raw(-2_000_000 * Fixed::SCALE),
            },
            JournalPosting {
                kind: JournalEntryKind::Position,
                amount: Fixed::from_raw(2_000_000 * Fixed::SCALE),
            },
        ];
        assert_eq!(
            account.post_journal(1, &postings),
            Err(PaperAccountError::InsufficientCash)
        );
    }

    #[test]
    fn stale_version_is_rejected() {
        let mut account = PaperAccount::open([1; 16], [2; 16], PaperAccountPolicy::V1);
        assert_eq!(
            account.initialize_cash(5),
            Err(PaperAccountError::WrongVersion {
                expected: 5,
                actual: 0
            })
        );
    }

    /// Golden failure set: accounting correction
    /// (`docs/v5/character-story-engine.md` "帳本事件不可修改或刪除。市場資料更正
    /// 以新 revision 重算 projection"). A correction is an ADDITIONAL balanced
    /// posting batch (inverse then forward), never a mutation of the original
    /// fill's postings -- `PaperAccount` has no method that edits history, only
    /// `post_journal`, so a correction is structurally just another call to it.
    #[test]
    fn accounting_correction_is_an_additional_balanced_batch_not_a_rewrite() {
        let mut account = PaperAccount::open([1; 16], [2; 16], PaperAccountPolicy::V1);
        account.initialize_cash(0).expect("initialize");
        let notional = Fixed::from_raw(100_000 * Fixed::SCALE);
        let original_fill = [
            JournalPosting {
                kind: JournalEntryKind::Cash,
                amount: notional.checked_mul(Fixed::NEG_ONE).unwrap(),
            },
            JournalPosting {
                kind: JournalEntryKind::Position,
                amount: notional,
            },
        ];
        let (_, cash_after_original_fill) = account.post_journal(1, &original_fill).expect("original fill");

        // A source-fact correction revises the fill price downward by 1,000
        // (fixed-point units): inverse the original position posting, then
        // forward-post the corrected notional. The original fill's postings
        // above are untouched -- this is a strictly additive third journal
        // entry, not an edit of the first two.
        let corrected_notional = Fixed::from_raw(99_000 * Fixed::SCALE);
        let correction = [
            JournalPosting {
                kind: JournalEntryKind::Cash,
                amount: notional.checked_sub(corrected_notional).unwrap(),
            },
            JournalPosting {
                kind: JournalEntryKind::Position,
                amount: corrected_notional.checked_sub(notional).unwrap(),
            },
        ];
        let (cash_before_correction, cash_after_correction) =
            account.post_journal(2, &correction).expect("correction balances to zero");
        assert_eq!(cash_before_correction, cash_after_original_fill);
        assert_eq!(
            cash_after_correction,
            cash_after_original_fill.checked_add(notional.checked_sub(corrected_notional).unwrap()).unwrap()
        );
        // The account's own version counter is strictly increasing -- there is
        // no "go back and edit version 1" operation available on this type.
        assert_eq!(account.stream_version, 3);
    }
}
