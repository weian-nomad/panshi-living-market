#![no_std]
#![forbid(unsafe_code)]

mod decision;
mod fixed;
mod utility;

pub use decision::{
    ALGORITHM_ID, CompanyActionInput, Direction, FiveSeatDecision, KERNEL_ABI, KernelError,
    SeatAction, SeatDecisionInput, decide_five_seats, decide_seat,
};
pub use fixed::{Fixed, FixedError};
pub use utility::{
    action_utility, action_utility_numerator, confidence_levels_at_or_below, utility_from_numerator,
};
