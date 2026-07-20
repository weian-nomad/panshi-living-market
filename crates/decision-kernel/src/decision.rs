use core::cmp::Ordering;

use sha2::{Digest as _, Sha256};

use crate::{
    Fixed, FixedError, action_utility_numerator, confidence_levels_at_or_below,
    utility_from_numerator,
};

pub type EntityId = [u8; 16];
pub type SeedReference = [u8; 32];

pub const KERNEL_ABI: &str = "panshi-decision-kernel/wasi-v1";
pub const ALGORITHM_ID: &str = "five-seat-action-policy/1";

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
#[repr(u8)]
pub enum Direction {
    NoAction = 0,
    Upside = 1,
    Downside = 2,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CompanyActionInput {
    pub company_id: EntityId,
    /// Final normalized conviction for an upside action, in [-1, 1].
    pub upside_conviction: Fixed,
    /// Final normalized conviction for a downside action, in [-1, 1].
    pub downside_conviction: Fixed,
    pub upside_allowed: bool,
    pub downside_allowed: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SeatDecisionInput {
    /// Canonical fixed seat index: 0 through 4.
    pub seat_index: u8,
    pub character_id: EntityId,
    pub companies: [CompanyActionInput; 4],
    pub qmax: Fixed,
    pub resistance: Fixed,
    pub no_action_utility: Fixed,
    /// A per-seat HMAC-derived value frozen in the decision snapshot.
    pub tie_break_seed: SeedReference,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SeatAction {
    pub seat_index: u8,
    pub character_id: EntityId,
    pub company_id: Option<EntityId>,
    pub direction: Direction,
    pub confidence: Fixed,
    pub first_utility: Fixed,
    pub second_utility: Fixed,
    pub utility_gap: Fixed,
    pub seed_reference: SeedReference,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FiveSeatDecision {
    pub actions: [SeatAction; 5],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum KernelError {
    Fixed(FixedError),
    InvalidSeatOrder,
    InvalidQmax,
    InvalidResistance,
    DuplicateCompany,
    NonCanonicalCompanyOrder,
    ZeroCompanyId,
}

impl From<FixedError> for KernelError {
    fn from(error: FixedError) -> Self {
        Self::Fixed(error)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Candidate {
    company_id: Option<EntityId>,
    direction: Direction,
    confidence: Fixed,
    utility: Fixed,
    utility_numerator: i128,
    tie_break_rank: [u8; 32],
}

/// Produces the canonical five-seat action batch without clocks, I/O, or
/// runtime randomness.
///
/// # Errors
///
/// Rejects non-canonical seat order and forwards any per-seat validation or
/// fixed-point arithmetic failure.
pub fn decide_five_seats(inputs: &[SeatDecisionInput; 5]) -> Result<FiveSeatDecision, KernelError> {
    for (index, input) in inputs.iter().enumerate() {
        if usize::from(input.seat_index) != index {
            return Err(KernelError::InvalidSeatOrder);
        }
    }

    Ok(FiveSeatDecision {
        actions: [
            decide_seat(&inputs[0])?,
            decide_seat(&inputs[1])?,
            decide_seat(&inputs[2])?,
            decide_seat(&inputs[3])?,
            decide_seat(&inputs[4])?,
        ],
    })
}

/// Selects the highest-utility legal candidate for one seat. `NO_ACTION` is
/// always present, including when `qmax` is zero.
///
/// Equal utilities are ordered by a SHA-256 rank derived from the frozen
/// per-seat seed and canonical candidate bytes. The seed itself is expected to
/// be derived by the snapshot sealer from the committed season secret.
///
/// # Errors
///
/// Rejects out-of-range risk inputs, duplicate company IDs, and fixed-point
/// overflow.
pub fn decide_seat(input: &SeatDecisionInput) -> Result<SeatAction, KernelError> {
    validate(input)?;

    let no_action = candidate(
        input.tie_break_seed,
        None,
        Direction::NoAction,
        Fixed::ZERO,
        no_action_numerator(input.no_action_utility)?,
    )?;
    let mut best = no_action;
    let mut second: Option<Candidate> = None;

    for company in input.companies {
        for (direction, conviction, allowed) in [
            (
                Direction::Upside,
                company.upside_conviction,
                company.upside_allowed,
            ),
            (
                Direction::Downside,
                company.downside_conviction,
                company.downside_allowed,
            ),
        ] {
            if !allowed {
                continue;
            }
            let conviction = conviction.clamp(Fixed::NEG_ONE, Fixed::ONE);
            for confidence in confidence_levels_at_or_below(input.qmax) {
                let contender = candidate(
                    input.tie_break_seed,
                    Some(company.company_id),
                    direction,
                    confidence,
                    action_utility_numerator(confidence, conviction, input.resistance)?,
                )?;
                insert_candidate(contender, &mut best, &mut second);
            }
        }
    }

    let second = second.unwrap_or(no_action);
    Ok(SeatAction {
        seat_index: input.seat_index,
        character_id: input.character_id,
        company_id: best.company_id,
        direction: best.direction,
        confidence: best.confidence,
        first_utility: best.utility,
        second_utility: second.utility,
        utility_gap: utility_from_numerator(
            best.utility_numerator
                .checked_sub(second.utility_numerator)
                .ok_or(KernelError::Fixed(FixedError::Overflow))?,
        )?,
        seed_reference: input.tie_break_seed,
    })
}

fn validate(input: &SeatDecisionInput) -> Result<(), KernelError> {
    if input.qmax < Fixed::ZERO || input.qmax > Fixed::ONE {
        return Err(KernelError::InvalidQmax);
    }
    if input.resistance < Fixed::ZERO {
        return Err(KernelError::InvalidResistance);
    }
    for right in 1..input.companies.len() {
        if input.companies[right - 1].company_id > input.companies[right].company_id {
            return Err(KernelError::NonCanonicalCompanyOrder);
        }
        for left in 0..right {
            if input.companies[left].company_id == input.companies[right].company_id {
                return Err(KernelError::DuplicateCompany);
            }
        }
    }
    if input
        .companies
        .iter()
        .any(|company| company.company_id == [0; 16])
    {
        return Err(KernelError::ZeroCompanyId);
    }
    Ok(())
}

fn candidate(
    seed: SeedReference,
    company_id: Option<EntityId>,
    direction: Direction,
    confidence: Fixed,
    utility_numerator: i128,
) -> Result<Candidate, KernelError> {
    let mut hasher = Sha256::new();
    hasher.update(b"PSZS/TIE/v1\0");
    hasher.update(seed);
    hasher.update(company_id.unwrap_or([0; 16]));
    hasher.update([direction as u8]);
    hasher.update(confidence.raw().to_be_bytes());
    Ok(Candidate {
        company_id,
        direction,
        confidence,
        utility: utility_from_numerator(utility_numerator)?,
        utility_numerator,
        tie_break_rank: hasher.finalize().into(),
    })
}

fn no_action_numerator(utility: Fixed) -> Result<i128, KernelError> {
    i128::from(utility.raw())
        .checked_mul(i128::from(Fixed::SCALE))
        .and_then(|value| value.checked_mul(i128::from(Fixed::SCALE)))
        .ok_or(KernelError::Fixed(FixedError::Overflow))
}

fn insert_candidate(contender: Candidate, best: &mut Candidate, second: &mut Option<Candidate>) {
    if outranks(&contender, best) {
        *second = Some(*best);
        *best = contender;
    } else if second
        .as_ref()
        .is_none_or(|current| outranks(&contender, current))
    {
        *second = Some(contender);
    }
}

fn outranks(left: &Candidate, right: &Candidate) -> bool {
    match left.utility_numerator.cmp(&right.utility_numerator) {
        Ordering::Greater => true,
        Ordering::Less => false,
        Ordering::Equal => left.tie_break_rank < right.tie_break_rank,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CompanyActionInput, Direction, KernelError, SeatDecisionInput, decide_five_seats,
        decide_seat,
    };
    use crate::Fixed;

    fn company(id: u8, upside: i64, downside: i64) -> CompanyActionInput {
        CompanyActionInput {
            company_id: [id; 16],
            upside_conviction: Fixed::from_raw(upside),
            downside_conviction: Fixed::from_raw(downside),
            upside_allowed: true,
            downside_allowed: true,
        }
    }

    fn seat(index: u8) -> SeatDecisionInput {
        SeatDecisionInput {
            seat_index: index,
            character_id: [index + 10; 16],
            companies: [
                company(1, 800_000, -800_000),
                company(2, 300_000, -300_000),
                company(3, 100_000, -100_000),
                company(4, 0, 0),
            ],
            qmax: Fixed::ONE,
            resistance: Fixed::ONE,
            no_action_utility: Fixed::ZERO,
            tie_break_seed: [index + 20; 32],
        }
    }

    #[test]
    fn strong_conviction_selects_company_and_direction() {
        let action = decide_seat(&seat(0)).expect("valid decision");
        assert_eq!(action.company_id, Some([1; 16]));
        assert_eq!(action.direction, Direction::Upside);
        assert_eq!(action.confidence, Fixed::from_raw(750_000));
        assert!(action.utility_gap > Fixed::ZERO);
    }

    #[test]
    fn qmax_zero_makes_no_action_the_only_candidate() {
        let mut input = seat(0);
        input.qmax = Fixed::ZERO;
        assert_eq!(
            decide_seat(&input)
                .expect("no action remains legal")
                .direction,
            Direction::NoAction
        );
    }

    #[test]
    fn non_canonical_company_order_and_zero_ids_fail_closed() {
        let mut input = seat(0);
        input.companies.swap(0, 1);
        assert_eq!(
            decide_seat(&input),
            Err(KernelError::NonCanonicalCompanyOrder)
        );

        let mut input = seat(0);
        input.companies[0].company_id = [0; 16];
        assert_eq!(decide_seat(&input), Err(KernelError::ZeroCompanyId));
    }

    #[test]
    fn exact_numerator_breaks_a_tie_hidden_by_display_rounding() {
        let mut input = seat(0);
        input.qmax = Fixed::from_raw(250_000);
        input.resistance = Fixed::from_raw(1);
        input.companies[0].upside_conviction = Fixed::from_raw(1);
        input.companies[1].upside_conviction = Fixed::from_raw(2);
        input.companies[2].upside_allowed = false;
        input.companies[2].downside_allowed = false;
        input.companies[3].upside_allowed = false;
        input.companies[3].downside_allowed = false;

        let action = decide_seat(&input).expect("valid exact comparison");
        assert_eq!(action.company_id, Some([2; 16]));
        assert_eq!(action.direction, Direction::Upside);
    }

    #[test]
    fn arithmetic_overflow_is_typed_and_never_wraps() {
        let mut input = seat(0);
        input.resistance = Fixed::from_raw(i64::MAX);
        assert_eq!(
            decide_seat(&input),
            Err(KernelError::Fixed(crate::FixedError::Overflow))
        );
    }

    #[test]
    fn invalid_seat_order_is_rejected_before_deciding() {
        let mut inputs = [seat(0), seat(1), seat(2), seat(3), seat(4)];
        inputs[3].seat_index = 4;
        assert_eq!(
            decide_five_seats(&inputs),
            Err(KernelError::InvalidSeatOrder)
        );
    }

    #[test]
    fn five_seat_batch_is_stable() {
        let inputs = [seat(0), seat(1), seat(2), seat(3), seat(4)];
        let first = decide_five_seats(&inputs).expect("valid batch");
        let second = decide_five_seats(&inputs).expect("valid replay");
        assert_eq!(first, second);
        assert_eq!(
            first.actions.map(|action| action.seat_index),
            [0, 1, 2, 3, 4]
        );
    }

    #[test]
    fn sealed_episode_001_matches_the_checked_in_golden_actions() {
        let mut inputs = [seat(0), seat(1), seat(2), seat(3), seat(4)];
        inputs[0].tie_break_seed = [0x20; 32];

        inputs[1].companies = [
            company(5, -300_000, 700_000),
            company(6, 200_000, 100_000),
            company(7, 100_000, 0),
            company(8, 0, 0),
        ];
        inputs[1].qmax = Fixed::from_raw(750_000);
        inputs[1].resistance = Fixed::from_raw(1_200_000);
        inputs[1].tie_break_seed = [0x21; 32];

        inputs[2].companies = [
            company(9, 900_000, -900_000),
            company(10, 500_000, -500_000),
            company(11, 300_000, -300_000),
            company(12, 100_000, -100_000),
        ];
        inputs[2].qmax = Fixed::ZERO;
        inputs[2].resistance = Fixed::from_raw(1_500_000);
        inputs[2].no_action_utility = Fixed::from_raw(150_000);
        inputs[2].tie_break_seed = [0x22; 32];

        inputs[3].companies = [
            company(13, 200_000, -200_000),
            company(14, 100_000, -100_000),
            company(15, 50_000, -50_000),
            company(20, 0, 0),
        ];
        inputs[3].qmax = Fixed::from_raw(500_000);
        inputs[3].resistance = Fixed::from_raw(1_200_000);
        inputs[3].no_action_utility = Fixed::from_raw(120_000);
        inputs[3].tie_break_seed = [0x23; 32];

        inputs[4].companies = [
            company(22, 950_000, -950_000),
            company(23, 500_000, -500_000),
            company(24, 250_000, -250_000),
            company(25, 0, 0),
        ];
        inputs[4].resistance = Fixed::from_raw(800_000);
        inputs[4].tie_break_seed = [0x24; 32];

        let actions = decide_five_seats(&inputs).expect("sealed fixture").actions;
        let compact = actions.map(|action| {
            (
                action.seat_index,
                action.company_id,
                action.direction,
                action.confidence.raw(),
                action.first_utility.raw(),
                action.second_utility.raw(),
                action.utility_gap.raw(),
            )
        });
        assert_eq!(
            compact,
            [
                (
                    0,
                    Some([1; 16]),
                    Direction::Upside,
                    750_000,
                    637_500,
                    600_000,
                    37_500
                ),
                (
                    1,
                    Some([5; 16]),
                    Direction::Downside,
                    500_000,
                    400_000,
                    375_000,
                    25_000
                ),
                (2, None, Direction::NoAction, 0, 150_000, 150_000, 0),
                (3, None, Direction::NoAction, 0, 120_000, 25_000, 95_000),
                (
                    4,
                    Some([22; 16]),
                    Direction::Upside,
                    1_000_000,
                    1_100_000,
                    975_000,
                    125_000
                ),
            ]
        );
    }
}
