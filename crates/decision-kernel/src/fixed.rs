use core::fmt;

/// Signed fixed-point value with six decimal places.
///
/// All arithmetic uses an `i128` intermediate and fails closed on overflow.
#[derive(Clone, Copy, Default, Eq, Ord, PartialEq, PartialOrd)]
pub struct Fixed(i64);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FixedError {
    DivisionByZero,
    Overflow,
}

impl Fixed {
    pub const SCALE: i64 = 1_000_000;
    pub const NEG_ONE: Self = Self(-Self::SCALE);
    pub const ZERO: Self = Self(0);
    pub const ONE: Self = Self(Self::SCALE);

    #[must_use]
    pub const fn from_raw(raw: i64) -> Self {
        Self(raw)
    }

    #[must_use]
    pub const fn raw(self) -> i64 {
        self.0
    }

    /// Adds two values.
    ///
    /// # Errors
    ///
    /// Returns [`FixedError::Overflow`] when the result cannot fit in `i64`.
    pub fn checked_add(self, rhs: Self) -> Result<Self, FixedError> {
        self.0
            .checked_add(rhs.0)
            .map(Self)
            .ok_or(FixedError::Overflow)
    }

    /// Subtracts two values.
    ///
    /// # Errors
    ///
    /// Returns [`FixedError::Overflow`] when the result cannot fit in `i64`.
    pub fn checked_sub(self, rhs: Self) -> Result<Self, FixedError> {
        self.0
            .checked_sub(rhs.0)
            .map(Self)
            .ok_or(FixedError::Overflow)
    }

    /// Multiplies two values through an `i128` intermediate.
    ///
    /// # Errors
    ///
    /// Returns [`FixedError::Overflow`] when the scaled result cannot fit in `i64`.
    pub fn checked_mul(self, rhs: Self) -> Result<Self, FixedError> {
        let raw = i128::from(self.0) * i128::from(rhs.0) / i128::from(Self::SCALE);
        i64::try_from(raw)
            .map(Self)
            .map_err(|_| FixedError::Overflow)
    }

    /// Divides two values through an `i128` intermediate.
    ///
    /// # Errors
    ///
    /// Returns [`FixedError::DivisionByZero`] for a zero divisor and
    /// [`FixedError::Overflow`] when the scaled result cannot fit in `i64`.
    pub fn checked_div(self, rhs: Self) -> Result<Self, FixedError> {
        if rhs == Self::ZERO {
            return Err(FixedError::DivisionByZero);
        }
        let raw = i128::from(self.0) * i128::from(Self::SCALE) / i128::from(rhs.0);
        i64::try_from(raw)
            .map(Self)
            .map_err(|_| FixedError::Overflow)
    }

    #[must_use]
    pub const fn clamp(self, min: Self, max: Self) -> Self {
        if self.0 < min.0 {
            min
        } else if self.0 > max.0 {
            max
        } else {
            self
        }
    }
}

impl fmt::Debug for Fixed {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let sign = if self.0 < 0 { "-" } else { "" };
        let magnitude = self.0.unsigned_abs();
        write!(
            formatter,
            "{sign}{}.{:06}",
            magnitude / Self::SCALE.unsigned_abs(),
            magnitude % Self::SCALE.unsigned_abs()
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{Fixed, FixedError};

    #[test]
    fn multiplication_uses_six_decimal_places() {
        let half = Fixed::from_raw(500_000);
        assert_eq!(half.checked_mul(half), Ok(Fixed::from_raw(250_000)));
    }

    #[test]
    fn division_fails_closed() {
        assert_eq!(
            Fixed::ONE.checked_div(Fixed::ZERO),
            Err(FixedError::DivisionByZero)
        );
    }
}
