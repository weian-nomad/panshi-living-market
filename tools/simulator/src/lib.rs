#![forbid(unsafe_code)]

use panshi_decision_kernel::{
    ALGORITHM_ID, CompanyActionInput, Direction, Fixed, KERNEL_ABI, SeatDecisionInput,
    decide_five_seats,
};
use panshi_protocol::{
    canonical_bytes, domain_digest,
    game::v1::{
        CompanyActionInputV1, DecisionKernelInputV1, DecisionKernelOutputV1,
        Direction as WireDirection, SeatAction as WireSeatAction, SeatDecisionInputV1,
    },
    validate_decision_input_v1, validate_decision_output_v1,
};

pub const INPUT_TAG: &[u8] = b"PSZS/DECISION_INPUT/v1\0";
pub const ALGORITHM_TAG: &[u8] = b"PSZS/ALGORITHM_BUNDLE/v1\0";
pub const KERNEL_ABI_TAG: &[u8] = b"PSZS/KERNEL_ABI/v1\0";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GoldenEpisode {
    pub input_bytes: Vec<u8>,
    pub output_bytes: Vec<u8>,
    pub input_digest: [u8; 32],
}

/// Builds the sealed synthetic episode used by native and WASI qualification.
///
/// # Panics
///
/// Panics only when a source-controlled fixture violates its canonical wire
/// shape or the deterministic kernel rejects it. Either condition is a build
/// failure, not recoverable runtime input.
#[must_use]
pub fn sealed_episode_001() -> GoldenEpisode {
    let inputs = episode_inputs();
    let kernel_abi_digest = domain_digest(KERNEL_ABI_TAG, KERNEL_ABI.as_bytes());
    let algorithm_digest = algorithm_bundle_digest();
    let input = DecisionKernelInputV1 {
        schema_version: 1,
        algorithm_digest: algorithm_digest.to_vec(),
        snapshot_digest: vec![0x31; 32],
        decision_input_sealed_event_id: vec![0x32; 16],
        decision_session_version: 4,
        decision_session_id: vec![0x33; 16],
        round_id: vec![0x34; 16],
        content_session_id: vec![0x35; 16],
        logical_cell_id: vec![0x36; 16],
        ownership_epoch: 7,
        seats: inputs.iter().map(to_wire_input).collect(),
        kernel_abi_digest: kernel_abi_digest.to_vec(),
    };
    validate_decision_input_v1(&input).expect("fixture input has canonical domain order");
    let input_bytes = canonical_bytes(&input);
    let input_digest = domain_digest(INPUT_TAG, &input_bytes);
    let decision = decide_five_seats(&inputs).expect("sealed episode is valid");
    let output = DecisionKernelOutputV1 {
        schema_version: 1,
        algorithm_digest: algorithm_digest.to_vec(),
        input_digest: input_digest.to_vec(),
        actions: decision.actions.iter().map(to_wire_action).collect(),
        kernel_abi_digest: kernel_abi_digest.to_vec(),
    };
    validate_decision_output_v1(&output).expect("fixture output has canonical domain order");

    GoldenEpisode {
        input_bytes,
        output_bytes: canonical_bytes(&output),
        input_digest,
    }
}

fn algorithm_bundle_digest() -> [u8; 32] {
    let policy = include_bytes!("../../../contracts/policy/decision-v1.json");
    let mut preimage = Vec::new();
    for section in [
        ALGORITHM_ID.as_bytes(),
        KERNEL_ABI.as_bytes(),
        policy.as_slice(),
    ] {
        preimage.extend(
            u64::try_from(section.len())
                .expect("policy artifact fits u64")
                .to_be_bytes(),
        );
        preimage.extend(section);
    }
    domain_digest(ALGORITHM_TAG, &preimage)
}

fn company(id: u8, upside: i64, downside: i64) -> CompanyActionInput {
    CompanyActionInput {
        company_id: [id; 16],
        upside_conviction: Fixed::from_raw(upside),
        downside_conviction: Fixed::from_raw(downside),
        upside_allowed: true,
        downside_allowed: true,
    }
}

fn base_seat(index: u8) -> SeatDecisionInput {
    SeatDecisionInput {
        seat_index: index,
        character_id: [index + 0x10; 16],
        companies: [
            company(1, 800_000, -800_000),
            company(2, 300_000, -300_000),
            company(3, 100_000, -100_000),
            company(4, 0, 0),
        ],
        qmax: Fixed::ONE,
        resistance: Fixed::ONE,
        no_action_utility: Fixed::ZERO,
        tie_break_seed: [index + 0x20; 32],
    }
}

fn episode_inputs() -> [SeatDecisionInput; 5] {
    let mut inputs = [
        base_seat(0),
        base_seat(1),
        base_seat(2),
        base_seat(3),
        base_seat(4),
    ];

    inputs[1].companies = [
        company(5, -300_000, 700_000),
        company(6, 200_000, 100_000),
        company(7, 100_000, 0),
        company(8, 0, 0),
    ];
    inputs[1].qmax = Fixed::from_raw(750_000);
    inputs[1].resistance = Fixed::from_raw(1_200_000);

    inputs[2].companies = [
        company(9, 900_000, -900_000),
        company(10, 500_000, -500_000),
        company(11, 300_000, -300_000),
        company(12, 100_000, -100_000),
    ];
    inputs[2].qmax = Fixed::ZERO;
    inputs[2].resistance = Fixed::from_raw(1_500_000);
    inputs[2].no_action_utility = Fixed::from_raw(150_000);

    inputs[3].companies = [
        company(13, 200_000, -200_000),
        company(14, 100_000, -100_000),
        company(15, 50_000, -50_000),
        company(20, 0, 0),
    ];
    inputs[3].qmax = Fixed::from_raw(500_000);
    inputs[3].resistance = Fixed::from_raw(1_200_000);
    inputs[3].no_action_utility = Fixed::from_raw(120_000);

    inputs[4].companies = [
        company(22, 950_000, -950_000),
        company(23, 500_000, -500_000),
        company(24, 250_000, -250_000),
        company(25, 0, 0),
    ];
    inputs[4].resistance = Fixed::from_raw(800_000);
    inputs
}

fn to_wire_input(input: &SeatDecisionInput) -> SeatDecisionInputV1 {
    SeatDecisionInputV1 {
        seat_id: i32::from(input.seat_index) + 1,
        character_id: input.character_id.to_vec(),
        companies: input
            .companies
            .iter()
            .map(|company| CompanyActionInputV1 {
                fictional_company_id: company.company_id.to_vec(),
                upside_conviction_fixed: company.upside_conviction.raw(),
                downside_conviction_fixed: company.downside_conviction.raw(),
                upside_allowed: company.upside_allowed,
                downside_allowed: company.downside_allowed,
            })
            .collect(),
        qmax_fixed: input.qmax.raw(),
        resistance_fixed: input.resistance.raw(),
        no_action_utility_fixed: input.no_action_utility.raw(),
        tie_break_seed: input.tie_break_seed.to_vec(),
    }
}

fn to_wire_action(action: &panshi_decision_kernel::SeatAction) -> WireSeatAction {
    WireSeatAction {
        seat_id: i32::from(action.seat_index) + 1,
        character_id: action.character_id.to_vec(),
        fictional_company_id: action.company_id.map_or_else(Vec::new, |id| id.to_vec()),
        direction: match action.direction {
            Direction::NoAction => WireDirection::NoAction as i32,
            Direction::Upside => WireDirection::Upside as i32,
            Direction::Downside => WireDirection::Downside as i32,
        },
        confidence_fixed: action.confidence.raw(),
        first_utility_fixed: action.first_utility.raw(),
        second_utility_fixed: action.second_utility.raw(),
        utility_gap_fixed: action.utility_gap.raw(),
        seed_reference: action.seed_reference.to_vec(),
    }
}

#[cfg(test)]
mod tests {
    use panshi_protocol::{
        decode_canonical,
        game::v1::{DecisionKernelInputV1, DecisionKernelOutputV1},
    };

    use super::sealed_episode_001;

    #[test]
    fn checked_in_protobuf_golden_bytes_match_the_native_kernel() {
        let expected = sealed_episode_001();
        let input_bytes = include_bytes!("../../../fixtures/historical/episode-001/input.pb");
        let output_bytes = include_bytes!("../../../fixtures/historical/episode-001/output.pb");

        decode_canonical::<DecisionKernelInputV1>(input_bytes).expect("canonical input fixture");
        decode_canonical::<DecisionKernelOutputV1>(output_bytes).expect("canonical output fixture");
        assert_eq!(input_bytes.as_slice(), expected.input_bytes);
        assert_eq!(output_bytes.as_slice(), expected.output_bytes);
    }
}
