use crate::{Fixed, FixedError};

/// U(c,d,q) = 2qC(c,d) - q²R.
///
/// # Errors
///
/// Returns [`FixedError::Overflow`] when an intermediate or final value cannot
/// fit in the canonical fixed-point representation.
pub fn action_utility(
    confidence: Fixed,
    conviction: Fixed,
    resistance: Fixed,
) -> Result<Fixed, FixedError> {
    utility_from_numerator(action_utility_numerator(
        confidence, conviction, resistance,
    )?)
}

/// Exact numerator for `U`, scaled by `Fixed::SCALE³`.
///
/// Comparing this value avoids intermediate rounding changing candidate order.
///
/// # Errors
///
/// Returns [`FixedError::Overflow`] when checked `i128` arithmetic fails.
pub fn action_utility_numerator(
    confidence: Fixed,
    conviction: Fixed,
    resistance: Fixed,
) -> Result<i128, FixedError> {
    let q = i128::from(confidence.raw());
    let conviction = i128::from(conviction.raw());
    let resistance = i128::from(resistance.raw());
    let scale = i128::from(Fixed::SCALE);
    let reward = 2_i128
        .checked_mul(q)
        .and_then(|value| value.checked_mul(conviction))
        .and_then(|value| value.checked_mul(scale))
        .ok_or(FixedError::Overflow)?;
    let penalty = q
        .checked_mul(q)
        .and_then(|value| value.checked_mul(resistance))
        .ok_or(FixedError::Overflow)?;
    reward.checked_sub(penalty).ok_or(FixedError::Overflow)
}

/// Converts the exact utility numerator to external fixed-point form using
/// truncation toward zero.
///
/// # Errors
///
/// Returns [`FixedError::Overflow`] when the result cannot fit in `i64`.
pub fn utility_from_numerator(numerator: i128) -> Result<Fixed, FixedError> {
    let divisor = i128::from(Fixed::SCALE)
        .checked_mul(i128::from(Fixed::SCALE))
        .ok_or(FixedError::Overflow)?;
    i64::try_from(numerator / divisor)
        .map(Fixed::from_raw)
        .map_err(|_| FixedError::Overflow)
}

/// Canonical confidence candidates, excluding `NO_ACTION` which is always a
/// separate action candidate.
pub fn confidence_levels_at_or_below(qmax: Fixed) -> impl Iterator<Item = Fixed> {
    const LEVELS: [Fixed; 4] = [
        Fixed::from_raw(250_000),
        Fixed::from_raw(500_000),
        Fixed::from_raw(750_000),
        Fixed::ONE,
    ];
    LEVELS.into_iter().filter(move |level| *level <= qmax)
}

#[cfg(test)]
mod tests {
    use super::{action_utility, confidence_levels_at_or_below};
    use crate::Fixed;

    #[test]
    fn qmax_zero_removes_every_directional_confidence() {
        assert_eq!(confidence_levels_at_or_below(Fixed::ZERO).count(), 0);
    }

    #[test]
    fn utility_matches_the_frozen_equation() {
        let utility = action_utility(
            Fixed::from_raw(500_000),
            Fixed::from_raw(600_000),
            Fixed::from_raw(1_200_000),
        );
        assert_eq!(utility, Ok(Fixed::from_raw(300_000)));
    }
}
