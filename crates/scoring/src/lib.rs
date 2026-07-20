#![forbid(unsafe_code)]

use panshi_decision_kernel::{Fixed, FixedError};

const FOUR: Fixed = Fixed::from_raw(4_000_000);
const TWO: Fixed = Fixed::from_raw(2_000_000);
const FULL_COVERAGE_Q: Fixed = Fixed::from_raw(8_000_000);

/// DP = 4 × (2qy - q²), where y is exactly -1, 0, or 1.
///
/// # Errors
///
/// Returns [`FixedError::Overflow`] if the score cannot fit in the canonical
/// fixed-point representation.
///
/// # Panics
///
/// Panics when `outcome` is not one of `-1`, `0`, or `1`. Outcome validation is
/// a boundary invariant and invalid values must never enter the scoring kernel.
pub fn decision_score(confidence: Fixed, outcome: i8) -> Result<Fixed, FixedError> {
    assert!((-1..=1).contains(&outcome), "outcome must be -1, 0, or 1");
    let y = Fixed::from_raw(i64::from(outcome) * Fixed::SCALE);
    let directional = TWO.checked_mul(confidence)?.checked_mul(y)?;
    let calibration = confidence.checked_mul(confidence)?;
    FOUR.checked_mul(directional.checked_sub(calibration)?)
}

/// Coverage = min(1, Σq / 8).
///
/// # Errors
///
/// Returns [`FixedError::Overflow`] if the scaled division cannot fit in the
/// canonical fixed-point representation.
pub fn coverage(q_sum: Fixed) -> Result<Fixed, FixedError> {
    Ok(q_sum
        .checked_div(FULL_COVERAGE_Q)?
        .clamp(Fixed::ZERO, Fixed::ONE))
}

/// Positive raw score is coverage-adjusted; non-positive score is retained.
///
/// # Errors
///
/// Returns [`FixedError::Overflow`] if the adjusted positive score cannot fit
/// in the canonical fixed-point representation.
pub fn seat_score(raw: Fixed, seat_coverage: Fixed) -> Result<Fixed, FixedError> {
    if raw <= Fixed::ZERO {
        Ok(raw)
    } else {
        raw.checked_mul(seat_coverage)
    }
}

#[cfg(test)]
mod tests {
    use super::{coverage, decision_score, seat_score};
    use panshi_decision_kernel::Fixed;

    #[test]
    fn frozen_score_table_is_exact() {
        let cases = [
            (250_000, 1, 1_750_000),
            (250_000, -1, -2_250_000),
            (250_000, 0, -250_000),
            (500_000, 1, 3_000_000),
            (500_000, -1, -5_000_000),
            (500_000, 0, -1_000_000),
            (750_000, 1, 3_750_000),
            (750_000, -1, -8_250_000),
            (750_000, 0, -2_250_000),
            (1_000_000, 1, 4_000_000),
            (1_000_000, -1, -12_000_000),
            (1_000_000, 0, -4_000_000),
        ];
        for (q, y, expected) in cases {
            assert_eq!(
                decision_score(Fixed::from_raw(q), y),
                Ok(Fixed::from_raw(expected))
            );
        }
    }

    #[test]
    fn one_full_exposure_keeps_one_eighth_of_positive_score() {
        let one_eighth = coverage(Fixed::ONE).expect("coverage");
        assert_eq!(one_eighth, Fixed::from_raw(125_000));
        assert_eq!(
            seat_score(Fixed::from_raw(4_000_000), one_eighth),
            Ok(Fixed::from_raw(500_000))
        );
    }

    #[test]
    fn negative_score_is_not_diluted() {
        assert_eq!(
            seat_score(Fixed::from_raw(-5_000_000), Fixed::from_raw(125_000)),
            Ok(Fixed::from_raw(-5_000_000))
        );
    }
}
