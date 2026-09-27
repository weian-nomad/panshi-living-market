//! Deterministic property test for the paper-ledger lock
//! (`docs/v5/delivery-plan.md` "帳本鎖：紙上 ledger 在成交、費用、停牌、公司行動和
//! 修正下仍守恆"). No external property-testing crate: a local `SplitMix64`
//! generates `PROPERTY_CASES` seeded operation sequences, and every invariant
//! is checked after every step.
//!
//! Fee, tax, withholding, and share-ratio values below are fixture
//! parameters for exercising the ledger, not statements about real tax law.

use panshi_decision_kernel::Fixed;
use panshi_paper_ledger::account::{
    JournalEntryKind, JournalPosting, PaperAccount, PaperAccountError, PaperAccountPolicy,
};
use panshi_paper_ledger::corporate_action::{
    CashDividendPostings, CorporateActionError, ShareAdjustment, cash_dividend_postings,
    reversal_batch,
};
use panshi_paper_ledger::execution::{
    ExecutionCostSchedule, ExecutionError, InstrumentMarket, TradingStatus, buy_fill_postings,
    fill_order, sell_fill_postings,
};
use panshi_paper_ledger::order::{OrderSide, PaperOrder, PaperOrderState};
use panshi_paper_ledger::position::{Lot, PaperPosition, PaperPositionState};

const PROPERTY_CASES: usize = 1_024;
const STEPS_PER_CASE: usize = 72;
const INSTRUMENTS: usize = 2;
const MAX_LOTS: usize = 32;
const MAX_SHARES_AFTER_MULTIPLIER: i64 = 5_000_000;

/// Fixture execution rulesets (basis points).
const SCHEDULES: [ExecutionCostSchedule; 3] = [
    ExecutionCostSchedule {
        buy_fee_bp: 14,
        sell_fee_bp: 14,
        sell_tax_bp: 30,
    },
    ExecutionCostSchedule {
        buy_fee_bp: 0,
        sell_fee_bp: 0,
        sell_tax_bp: 0,
    },
    ExecutionCostSchedule {
        buy_fee_bp: 7,
        sell_fee_bp: 25,
        sell_tax_bp: 15,
    },
];
/// Fixture dividend withholding rates (basis points).
const WITHHOLDING_BP: [i32; 3] = [0, 211, 1_000];
/// Fixture share ratios: 2:1 split, 1:2 reverse split, 10% and 5% stock
/// dividends, 3:2 split, 1:4 reverse split, 3:1 split.
const SHARE_RATIOS_RAW: [i64; 7] = [
    2_000_000, 500_000, 1_100_000, 1_050_000, 1_500_000, 250_000, 3_000_000,
];

struct SplitMix64(u64);

impl SplitMix64 {
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform-enough integer in `0..n` (modulo bias is irrelevant here).
    fn below(&mut self, n: u64) -> i64 {
        i64::try_from(self.next_u64() % n).expect("n fits i64")
    }

    fn index(&mut self, n: usize) -> usize {
        usize::try_from(self.next_u64() % u64::try_from(n).expect("usize fits u64"))
            .expect("fits usize")
    }

    fn chance(&mut self, percent: u64) -> bool {
        self.next_u64() % 100 < percent
    }
}

fn units(n: i64) -> Fixed {
    Fixed::from_raw(n * Fixed::SCALE)
}

fn add(a: Fixed, b: Fixed) -> Fixed {
    a.checked_add(b).expect("property values fit Fixed")
}

fn sub(a: Fixed, b: Fixed) -> Fixed {
    a.checked_sub(b).expect("property values fit Fixed")
}

fn neg(a: Fixed) -> Fixed {
    a.checked_mul(Fixed::NEG_ONE)
        .expect("property values fit Fixed")
}

fn batch_sum(postings: &[JournalPosting]) -> Fixed {
    postings
        .iter()
        .fold(Fixed::ZERO, |total, p| add(total, p.amount))
}

#[derive(Clone)]
enum LastAction {
    Dividend {
        dividend: CashDividendPostings,
        held_quantity: Fixed,
        withholding_bp: i32,
    },
    Share(Box<ShareAdjustment>),
}

struct Instrument {
    market: InstrumentMarket,
    /// `Some(Closed)` keeps a closed position's realized P&L visible until
    /// the next buy rolls it into `closed_realized`.
    position: Option<PaperPosition>,
    closed_realized: Fixed,
    last_action: Option<LastAction>,
}

impl Instrument {
    fn open_position(&self) -> Option<&PaperPosition> {
        self.position
            .as_ref()
            .filter(|p| p.state == PaperPositionState::Open)
    }

    fn realized(&self) -> Fixed {
        add(
            self.closed_realized,
            self.position.map_or(Fixed::ZERO, |p| p.realized_pnl),
        )
    }
}

struct TrackedOrder {
    order: PaperOrder,
    instrument: usize,
    fills: u32,
    /// Set once the harness observes this order pending while its
    /// instrument is halted.
    lived_through_halt: bool,
}

#[derive(Default)]
struct Totals {
    cash: Fixed,
    position: Fixed,
    fee: Fixed,
    tax: Fixed,
    realized: Fixed,
    corporate_action: Fixed,
}

#[derive(Default)]
struct Coverage {
    buys_with_fee: u64,
    sells_with_tax: u64,
    halted_fill_rejections: u64,
    halted_price_rejections: u64,
    spanned_halt_expiries: u64,
    cash_dividends: u64,
    withheld_dividends: u64,
    splits: u64,
    stock_dividends: u64,
    rounding_tranches: u64,
    cash_in_lieu: u64,
    lot_table_full: u64,
    dividend_corrections: u64,
    share_corrections: u64,
    double_fill_rejections: u64,
}

struct World {
    rng: SplitMix64,
    schedule: ExecutionCostSchedule,
    account: PaperAccount,
    instruments: Vec<Instrument>,
    orders: Vec<TrackedOrder>,
    now: i64,
    next_id: u8,
    totals: Totals,
    halted_fills: u64,
    fills_after_living_through_halt: u64,
    coverage: Coverage,
}

impl World {
    fn new(seed: u64) -> Self {
        let mut rng = SplitMix64(seed);
        let schedule = SCHEDULES[rng.index(SCHEDULES.len())];
        let mut account = PaperAccount::open([1; 16], [2; 16], PaperAccountPolicy::V1);
        account.initialize_cash(0).expect("initialize");
        let instruments = (0..INSTRUMENTS)
            .map(|i| {
                let tag = u8::try_from(10 + i).expect("small");
                Instrument {
                    market: InstrumentMarket::new([tag; 32]),
                    position: None,
                    closed_realized: Fixed::ZERO,
                    last_action: None,
                }
            })
            .collect();
        Self {
            rng,
            schedule,
            account,
            instruments,
            orders: Vec::new(),
            now: 0,
            next_id: 0,
            totals: Totals::default(),
            halted_fills: 0,
            fills_after_living_through_halt: 0,
            coverage: Coverage::default(),
        }
    }

    fn fresh_id(&mut self) -> [u8; 16] {
        self.next_id = self.next_id.wrapping_add(1);
        let mut id = [0; 16];
        id[0] = self.next_id;
        id[1..9].copy_from_slice(&self.now.to_le_bytes());
        id
    }

    fn random_price(&mut self) -> Fixed {
        // 10.00 ..= 999.99 on a 0.01 grid.
        Fixed::from_raw((1_000 + self.rng.below(99_000)) * 10_000)
    }

    /// Posts one batch, asserting it balances, and folds it into the
    /// per-kind journal totals.
    fn post(&mut self, postings: &[JournalPosting]) -> Result<(), PaperAccountError> {
        assert_eq!(
            batch_sum(postings),
            Fixed::ZERO,
            "every batch must sum to zero"
        );
        let version = self.account.stream_version;
        self.account.post_journal(version, postings)?;
        for posting in postings {
            let slot = match posting.kind {
                JournalEntryKind::Cash => &mut self.totals.cash,
                JournalEntryKind::Position => &mut self.totals.position,
                JournalEntryKind::FeeExpense => &mut self.totals.fee,
                JournalEntryKind::TaxExpense => &mut self.totals.tax,
                JournalEntryKind::RealizedPnl => &mut self.totals.realized,
                JournalEntryKind::CorporateAction => &mut self.totals.corporate_action,
            };
            *slot = add(*slot, posting.amount);
        }
        Ok(())
    }

    fn step(&mut self) {
        self.now += 10;
        match self.rng.below(100) {
            0..=21 => self.tick_price(),
            22..=29 => self.toggle_halt(),
            30..=47 => self.submit_order(OrderSide::Buy),
            48..=57 => self.submit_order(OrderSide::Sell),
            58..=65 => self.cash_dividend(),
            66..=75 => self.share_multiplier(),
            76..=85 => self.correction(),
            // Remaining steps: only time passes; `process_orders` below still
            // fills or expires pending orders.
            _ => {}
        }
        self.process_orders();
    }

    fn tick_price(&mut self) {
        let i = self.rng.index(INSTRUMENTS);
        let price = self.random_price();
        let now = self.now;
        let market = &mut self.instruments[i].market;
        let before = market.last_accepted();
        match market.accept_price(price, now) {
            Ok(accepted) => assert_eq!(accepted.price, price),
            Err(ExecutionError::Halted) => {
                assert_eq!(market.status(), TradingStatus::Halted);
                assert_eq!(
                    market.last_accepted(),
                    before,
                    "halt must not invent a price"
                );
                self.coverage.halted_price_rejections += 1;
            }
            Err(other) => panic!("unexpected price rejection {other:?}"),
        }
    }

    fn toggle_halt(&mut self) {
        let i = self.rng.index(INSTRUMENTS);
        let now = self.now;
        let market = &mut self.instruments[i].market;
        match market.status() {
            TradingStatus::Trading => market.halt(now).expect("halt"),
            TradingStatus::Halted => market.resume(now).expect("resume"),
        }
    }

    fn submit_order(&mut self, side: OrderSide) {
        let i = self.rng.index(INSTRUMENTS);
        let quantity = match side {
            OrderSide::Buy => units(1 + self.rng.below(1_500)),
            OrderSide::Sell => {
                let Some(position) = self.instruments[i].open_position() else {
                    return;
                };
                let held = position.quantity().raw() / Fixed::SCALE;
                if held == 0 {
                    return;
                }
                units(1 + self.rng.below(u64::try_from(held).expect("positive")))
            }
        };
        let id = self.fresh_id();
        let expires = self.now + 10 * (1 + self.rng.below(4));
        let order = PaperOrder::submit(
            id,
            self.account.paper_account_id,
            self.instruments[i].market.security_id_hash,
            side,
            quantity,
            self.now,
            expires,
        );
        self.orders.push(TrackedOrder {
            order,
            instrument: i,
            fills: 0,
            lived_through_halt: false,
        });
    }

    fn process_orders(&mut self) {
        for index in 0..self.orders.len() {
            if self.orders[index].order.state != PaperOrderState::Submitted {
                continue;
            }
            self.process_order(index);
        }
        self.orders.retain(|tracked| {
            tracked.order.state == PaperOrderState::Submitted || tracked.fills > 0
        });
    }

    fn process_order(&mut self, index: usize) {
        let i = self.orders[index].instrument;
        let market = self.instruments[i].market;
        if market.status() == TradingStatus::Halted {
            self.orders[index].lived_through_halt = true;
        }
        let mut probe = self.orders[index].order;
        let version = probe.stream_version;
        match fill_order(&mut probe, version, &market) {
            Ok(accepted) => {
                if market.status() == TradingStatus::Halted {
                    self.halted_fills += 1;
                }
                if self.orders[index].lived_through_halt {
                    self.fills_after_living_through_halt += 1;
                }
                if self.economics_allow(index, accepted.price) {
                    self.execute_fill(index);
                } else {
                    self.orders[index].order.reject(version).expect("reject");
                }
            }
            Err(error) => {
                if error == ExecutionError::Halted {
                    self.coverage.halted_fill_rejections += 1;
                }
                if self.now > self.orders[index].order.expires_at_unix_micros {
                    if error == ExecutionError::OrderSpannedHalt {
                        self.coverage.spanned_halt_expiries += 1;
                    }
                    self.orders[index].order.expire(version).expect("expire");
                }
            }
        }
    }

    fn economics_allow(&self, index: usize, price: Fixed) -> bool {
        let tracked = &self.orders[index];
        let instrument = &self.instruments[tracked.instrument];
        match tracked.order.side {
            OrderSide::Buy => {
                let Ok(buy) = buy_fill_postings(price, tracked.order.quantity, &self.schedule)
                else {
                    return false;
                };
                let lot_room = instrument
                    .open_position()
                    .is_none_or(|p| p.lots().count() < MAX_LOTS);
                lot_room && self.account.cash >= neg(buy.postings[0].amount)
            }
            OrderSide::Sell => instrument
                .open_position()
                .is_some_and(|p| p.quantity() >= tracked.order.quantity),
        }
    }

    fn execute_fill(&mut self, index: usize) {
        let i = self.orders[index].instrument;
        let market = self.instruments[i].market;
        let version = self.orders[index].order.stream_version;
        let accepted = fill_order(&mut self.orders[index].order, version, &market)
            .expect("probe said fillable");
        self.orders[index].fills += 1;
        let order = self.orders[index].order;
        let schedule = self.schedule;
        match order.side {
            OrderSide::Buy => {
                let buy = buy_fill_postings(accepted.price, order.quantity, &schedule)
                    .expect("buy postings");
                let lot = Lot {
                    lot_id: order.paper_order_id,
                    quantity: order.quantity,
                    cost_basis: accepted.price,
                    opened_at_unix_micros: accepted.observed_at_unix_micros,
                };
                let instrument = &mut self.instruments[i];
                match instrument.position.as_mut() {
                    Some(position) if position.state == PaperPositionState::Open => {
                        let v = position.stream_version;
                        position.add_lot(v, lot).expect("lot room checked");
                    }
                    closed => {
                        if let Some(old) = closed {
                            instrument.closed_realized =
                                add(instrument.closed_realized, old.realized_pnl);
                        }
                        instrument.position = Some(PaperPosition::open(
                            order.paper_order_id,
                            order.paper_account_id,
                            order.security_id_hash,
                            lot,
                        ));
                    }
                }
                instrument.last_action = None;
                self.post(&buy.postings).expect("cash checked");
                if buy.fee > Fixed::ZERO {
                    self.coverage.buys_with_fee += 1;
                }
            }
            OrderSide::Sell => {
                let instrument = &mut self.instruments[i];
                let position = instrument.position.as_mut().expect("sell needs a position");
                let v = position.stream_version;
                let realized = position
                    .reduce(v, order.quantity, accepted.price)
                    .expect("quantity checked");
                instrument.last_action = None;
                let sale = sell_fill_postings(accepted.price, order.quantity, realized, &schedule)
                    .expect("sell postings");
                self.post(&sale.postings).expect("sell adds cash");
                if sale.tax > Fixed::ZERO {
                    self.coverage.sells_with_tax += 1;
                }
            }
        }
        // The same order can never fill twice.
        let v = self.orders[index].order.stream_version;
        assert!(fill_order(&mut self.orders[index].order, v, &market).is_err());
        self.coverage.double_fill_rejections += 1;
    }

    fn cash_dividend(&mut self) {
        let i = self.rng.index(INSTRUMENTS);
        let Some(held) = self.instruments[i]
            .open_position()
            .map(PaperPosition::quantity)
        else {
            return;
        };
        let per_share = Fixed::from_raw((1 + self.rng.below(500)) * 10_000);
        let withholding_bp = WITHHOLDING_BP[self.rng.index(WITHHOLDING_BP.len())];
        let dividend = cash_dividend_postings(held, per_share, withholding_bp).expect("dividend");
        assert_eq!(add(dividend.net, dividend.withholding_tax), dividend.gross);
        self.post(&dividend.postings).expect("dividend adds cash");
        self.instruments[i].last_action = Some(LastAction::Dividend {
            dividend,
            held_quantity: held,
            withholding_bp,
        });
        self.coverage.cash_dividends += 1;
        if dividend.withholding_tax > Fixed::ZERO {
            self.coverage.withheld_dividends += 1;
        }
    }

    fn share_multiplier(&mut self) {
        let i = self.rng.index(INSTRUMENTS);
        let ratio = Fixed::from_raw(SHARE_RATIOS_RAW[self.rng.index(SHARE_RATIOS_RAW.len())]);
        let cil_price = self.random_price();
        self.apply_share_multiplier(i, ratio, cil_price);
    }

    fn apply_share_multiplier(&mut self, i: usize, ratio: Fixed, cil_price: Fixed) {
        let Some(position) = self.instruments[i].open_position().copied() else {
            return;
        };
        let projected = position.quantity().checked_mul(ratio).expect("fits");
        if projected > units(MAX_SHARES_AFTER_MULTIPLIER) {
            return;
        }
        let cost_before = position.total_cost_basis().expect("fits");
        let mut next = position;
        match next.apply_share_multiplier(position.stream_version, ratio, cil_price) {
            Ok(adjustment) => {
                let cost_after = next.total_cost_basis().expect("fits");
                assert_eq!(adjustment.cost_basis_before, cost_before);
                assert_eq!(adjustment.cost_basis_after, cost_after);
                assert_eq!(
                    add(cost_after, adjustment.fractional_cost_removed),
                    cost_before,
                    "share multiplier must conserve total cost basis"
                );
                if adjustment.fractional_quantity == Fixed::ZERO {
                    assert_eq!(cost_after, cost_before);
                }
                let expected_quantity = sub(projected, adjustment.fractional_quantity);
                assert_eq!(adjustment.quantity_after, expected_quantity);
                if next.lots().count() > position.lots().count() {
                    self.coverage.rounding_tranches += 1;
                }
                if adjustment.cash_in_lieu > Fixed::ZERO {
                    self.coverage.cash_in_lieu += 1;
                }
                if ratio.raw() % Fixed::SCALE == 0 || ratio < Fixed::ONE {
                    self.coverage.splits += 1;
                } else {
                    self.coverage.stock_dividends += 1;
                }
                self.post(&adjustment.postings)
                    .expect("cash in lieu adds cash");
                let instrument = &mut self.instruments[i];
                instrument.position = Some(next);
                instrument.market.note_share_count_corporate_action();
                instrument.last_action = Some(LastAction::Share(Box::new(adjustment)));
            }
            Err(CorporateActionError::LotTableFull) => {
                assert_eq!(
                    next, position,
                    "a failed action must not mutate the position"
                );
                self.coverage.lot_table_full += 1;
            }
            Err(other) => panic!("unexpected corporate-action rejection {other:?}"),
        }
    }

    fn correction(&mut self) {
        let i = self.rng.index(INSTRUMENTS);
        let Some(action) = self.instruments[i].last_action.clone() else {
            return;
        };
        match action {
            LastAction::Dividend {
                dividend,
                held_quantity,
                withholding_bp,
            } => {
                let reversal = reversal_batch(&dividend.postings).expect("fits");
                if self.account.cash < dividend.net {
                    let snapshot = self.account;
                    assert_eq!(
                        self.post(&reversal),
                        Err(PaperAccountError::InsufficientCash)
                    );
                    assert_eq!(self.account, snapshot);
                    return;
                }
                self.post(&reversal).expect("cash checked");
                self.instruments[i].last_action = None;
                self.coverage.dividend_corrections += 1;
                if self.rng.chance(60) {
                    let per_share = Fixed::from_raw((1 + self.rng.below(500)) * 10_000);
                    let corrected =
                        cash_dividend_postings(held_quantity, per_share, withholding_bp)
                            .expect("dividend");
                    self.post(&corrected.postings).expect("dividend adds cash");
                    self.instruments[i].last_action = Some(LastAction::Dividend {
                        dividend: corrected,
                        held_quantity,
                        withholding_bp,
                    });
                }
            }
            LastAction::Share(adjustment) => {
                if self.account.cash < adjustment.cash_in_lieu {
                    return;
                }
                let instrument = &mut self.instruments[i];
                let position = instrument
                    .position
                    .as_mut()
                    .expect("share action left a position");
                let v = position.stream_version;
                let reversal = position
                    .reverse_share_adjustment(v, &adjustment)
                    .expect("unchanged since action");
                instrument.market.note_share_count_corporate_action();
                instrument.last_action = None;
                self.post(&reversal).expect("cash checked");
                self.coverage.share_corrections += 1;
                if self.rng.chance(60) {
                    let ratio =
                        Fixed::from_raw(SHARE_RATIOS_RAW[self.rng.index(SHARE_RATIOS_RAW.len())]);
                    self.apply_share_multiplier(i, ratio, adjustment.cash_in_lieu_price);
                }
            }
        }
    }

    fn check_invariants(&self) {
        let init = self.account.policy.initial_cash;
        assert!(
            self.account.cash >= Fixed::ZERO,
            "cash must stay non-negative"
        );
        assert_eq!(
            self.totals.cash,
            sub(self.account.cash, init),
            "cash postings reconcile"
        );
        let grand_total = [
            self.totals.cash,
            self.totals.position,
            self.totals.fee,
            self.totals.tax,
            self.totals.realized,
            self.totals.corporate_action,
        ]
        .into_iter()
        .fold(Fixed::ZERO, add);
        assert_eq!(grand_total, Fixed::ZERO, "journal is globally balanced");

        let mut market_value = Fixed::ZERO;
        let mut cost_basis = Fixed::ZERO;
        let mut realized = Fixed::ZERO;
        let mut unrealized = Fixed::ZERO;
        for instrument in &self.instruments {
            realized = add(realized, instrument.realized());
            let Some(position) = instrument.position else {
                continue;
            };
            for lot in position.lots() {
                assert!(
                    lot.quantity >= Fixed::ZERO,
                    "quantity must stay non-negative"
                );
                assert_eq!(
                    lot.quantity.raw() % Fixed::SCALE,
                    0,
                    "lots stay whole shares"
                );
            }
            cost_basis = add(cost_basis, position.total_cost_basis().expect("fits"));
            if position.lots().count() == 0 {
                continue;
            }
            let price = instrument
                .market
                .last_accepted()
                .expect("a held position implies an accepted price")
                .price;
            market_value = add(
                market_value,
                position.quantity().checked_mul(price).expect("fits"),
            );
            let mut probe = position;
            let v = probe.stream_version;
            unrealized = add(unrealized, probe.apply_mark(v, price).expect("mark"));
        }
        assert_eq!(
            self.totals.position, cost_basis,
            "position postings equal cost basis"
        );
        assert_eq!(
            neg(self.totals.realized),
            realized,
            "realized postings reconcile"
        );

        let dividends = neg(self.totals.corporate_action);
        let lhs = add(self.account.cash, market_value);
        let rhs = sub(
            sub(
                add(add(add(init, realized), unrealized), dividends),
                self.totals.fee,
            ),
            self.totals.tax,
        );
        assert_eq!(lhs, rhs, "equity identity");

        assert_eq!(self.halted_fills, 0, "no fill while halted");
        assert_eq!(
            self.fills_after_living_through_halt, 0,
            "an order that was pending during a halt can only expire"
        );
        assert!(
            self.orders.iter().all(|tracked| tracked.fills <= 1),
            "each order fills at most once"
        );
    }
}

fn run_case(seed: u64) -> World {
    let mut world = World::new(seed);
    // Seed both instruments with a first accepted price.
    for i in 0..INSTRUMENTS {
        world.now += 1;
        let price = world.random_price();
        let now = world.now;
        world.instruments[i]
            .market
            .accept_price(price, now)
            .expect("first price");
    }
    for _ in 0..STEPS_PER_CASE {
        world.step();
        world.check_invariants();
    }
    world
}

#[test]
fn conservation_property_holds_across_fee_tax_halt_dividend_split_and_correction() {
    let mut coverage = Coverage::default();
    for case in 0..PROPERTY_CASES {
        let world = run_case(0x5EED_0000_0000_0000 ^ u64::try_from(case).expect("fits"));
        let c = world.coverage;
        coverage.buys_with_fee += c.buys_with_fee;
        coverage.sells_with_tax += c.sells_with_tax;
        coverage.halted_fill_rejections += c.halted_fill_rejections;
        coverage.halted_price_rejections += c.halted_price_rejections;
        coverage.spanned_halt_expiries += c.spanned_halt_expiries;
        coverage.cash_dividends += c.cash_dividends;
        coverage.withheld_dividends += c.withheld_dividends;
        coverage.splits += c.splits;
        coverage.stock_dividends += c.stock_dividends;
        coverage.rounding_tranches += c.rounding_tranches;
        coverage.cash_in_lieu += c.cash_in_lieu;
        coverage.lot_table_full += c.lot_table_full;
        coverage.dividend_corrections += c.dividend_corrections;
        coverage.share_corrections += c.share_corrections;
        coverage.double_fill_rejections += c.double_fill_rejections;
    }
    // Non-vacuity: every scenario family was actually exercised.
    for (name, count) in [
        ("buys_with_fee", coverage.buys_with_fee),
        ("sells_with_tax", coverage.sells_with_tax),
        ("halted_fill_rejections", coverage.halted_fill_rejections),
        ("halted_price_rejections", coverage.halted_price_rejections),
        ("spanned_halt_expiries", coverage.spanned_halt_expiries),
        ("cash_dividends", coverage.cash_dividends),
        ("withheld_dividends", coverage.withheld_dividends),
        ("splits", coverage.splits),
        ("stock_dividends", coverage.stock_dividends),
        ("rounding_tranches", coverage.rounding_tranches),
        ("cash_in_lieu", coverage.cash_in_lieu),
        ("dividend_corrections", coverage.dividend_corrections),
        ("share_corrections", coverage.share_corrections),
        ("double_fill_rejections", coverage.double_fill_rejections),
    ] {
        assert!(count > 0, "property run never exercised {name}");
    }
}

#[test]
fn conservation_property_is_deterministic_per_seed() {
    let first = run_case(42);
    let second = run_case(42);
    assert_eq!(first.account, second.account);
    for (a, b) in first.instruments.iter().zip(&second.instruments) {
        assert_eq!(a.position, b.position);
        assert_eq!(a.market, b.market);
    }
}

#[test]
fn halt_counterexample_order_committed_while_halted_expires_even_after_resume() {
    let mut market = InstrumentMarket::new([9; 32]);
    market.accept_price(units(50), 1).expect("price");
    market.halt(2).expect("halt");
    let mut order = PaperOrder::submit([5; 16], [2; 16], [9; 32], OrderSide::Buy, units(10), 3, 30);
    assert_eq!(
        fill_order(&mut order, 0, &market),
        Err(ExecutionError::Halted)
    );
    market.resume(10).expect("resume");
    market.accept_price(units(45), 20).expect("post-halt price");
    // The post-halt price is inside the order's window, but the order lived
    // through the halt: it must not be completed with that price.
    assert_eq!(
        fill_order(&mut order, 0, &market),
        Err(ExecutionError::OrderSpannedHalt)
    );
    order.expire(0).expect("expire");
    // Counterexample control: an order committed after the resume fills.
    let mut after_resume =
        PaperOrder::submit([6; 16], [2; 16], [9; 32], OrderSide::Buy, units(10), 11, 30);
    assert!(fill_order(&mut after_resume, 0, &market).is_ok());
    assert_eq!(after_resume.state, PaperOrderState::Filled);
}
