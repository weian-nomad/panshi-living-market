#![forbid(unsafe_code)]

//! Generated transport messages. Domain and deterministic crates must never
//! depend on this crate.

use prost::Message;
use sha2::{Digest, Sha256};

pub mod common {
    #[allow(clippy::doc_markdown, clippy::must_use_candidate)]
    pub mod v1 {
        include!(concat!(env!("OUT_DIR"), "/panshi.common.v1.rs"));
    }
}

pub mod game {
    #[allow(clippy::doc_markdown, clippy::must_use_candidate)]
    pub mod v1 {
        include!(concat!(env!("OUT_DIR"), "/panshi.game.v1.rs"));
    }
}

pub const FILE_DESCRIPTOR_SET: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/panshi_descriptor.bin"));

/// Encodes a generated message into the canonical persisted byte sequence.
///
/// Canonical messages must not contain Protobuf maps, and repeated fields must
/// be ordered by the owning domain before this function is called.
#[must_use]
pub fn canonical_bytes(message: &impl Message) -> Vec<u8> {
    message.encode_to_vec()
}

/// Returns the SHA-256 digest of the canonical persisted bytes.
#[must_use]
pub fn canonical_digest(domain_tag: &[u8], message: &impl Message) -> [u8; 32] {
    domain_digest(domain_tag, &canonical_bytes(message))
}

/// Hashes canonical bytes with an explicit, NUL-terminated domain tag.
///
/// # Panics
///
/// Panics when the compile-time or caller-supplied tag is not NUL-terminated.
#[must_use]
pub fn domain_digest(domain_tag: &[u8], bytes: &[u8]) -> [u8; 32] {
    assert_eq!(domain_tag.last(), Some(&0), "digest tags must end in NUL");
    let mut hasher = Sha256::new();
    hasher.update(domain_tag);
    hasher.update(bytes);
    hasher.finalize().into()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CanonicalDecodeError {
    InvalidProtobuf,
    NonCanonicalBytes,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DecisionWireError {
    UnsupportedSchema,
    InvalidDigest,
    InvalidId,
    InvalidOwnershipEpoch,
    InvalidSeatCount,
    InvalidSeatOrder,
    InvalidCompanyCount,
    InvalidCompanyOrder,
    InvalidFixedPointRange,
    InvalidDirection,
    InvalidActionShape,
}

/// Decodes only a unique canonical protobuf representation.
///
/// Unknown fields, duplicate singular fields, non-minimal varints, and field
/// reordering are rejected because decode→re-encode must be byte-identical.
///
/// # Errors
///
/// Returns a typed error for invalid protobuf or any non-canonical encoding.
pub fn decode_canonical<M>(bytes: &[u8]) -> Result<M, CanonicalDecodeError>
where
    M: Message + Default,
{
    let message = M::decode(bytes).map_err(|_| CanonicalDecodeError::InvalidProtobuf)?;
    if canonical_bytes(&message) != bytes {
        return Err(CanonicalDecodeError::NonCanonicalBytes);
    }
    Ok(message)
}

/// Validates the domain-owned ordering and fixed-width fields that Protobuf
/// encoding alone cannot express.
///
/// # Errors
///
/// Rejects any Historical v1 decision input that cannot be converted into the
/// deterministic kernel without normalization or guessing.
pub fn validate_decision_input_v1(
    input: &game::v1::DecisionKernelInputV1,
) -> Result<(), DecisionWireError> {
    if input.schema_version != 1 {
        return Err(DecisionWireError::UnsupportedSchema);
    }
    for digest in [
        &input.algorithm_digest,
        &input.snapshot_digest,
        &input.kernel_abi_digest,
    ] {
        if digest.len() != 32 {
            return Err(DecisionWireError::InvalidDigest);
        }
    }
    for id in [
        &input.decision_input_sealed_event_id,
        &input.decision_session_id,
        &input.round_id,
        &input.content_session_id,
        &input.logical_cell_id,
    ] {
        if id.len() != 16 || id.iter().all(|byte| *byte == 0) {
            return Err(DecisionWireError::InvalidId);
        }
    }
    if input.ownership_epoch == 0 {
        return Err(DecisionWireError::InvalidOwnershipEpoch);
    }
    if input.seats.len() != 5 {
        return Err(DecisionWireError::InvalidSeatCount);
    }
    for (seat, expected_seat_id) in input.seats.iter().zip(1_i32..=5) {
        if seat.seat_id != expected_seat_id {
            return Err(DecisionWireError::InvalidSeatOrder);
        }
        if seat.character_id.len() != 16 || seat.character_id.iter().all(|byte| *byte == 0) {
            return Err(DecisionWireError::InvalidId);
        }
        if seat.companies.len() != 4 {
            return Err(DecisionWireError::InvalidCompanyCount);
        }
        if !(0..=1_000_000).contains(&seat.qmax_fixed) || seat.resistance_fixed < 0 {
            return Err(DecisionWireError::InvalidFixedPointRange);
        }
        if seat.tie_break_seed.len() != 32 {
            return Err(DecisionWireError::InvalidDigest);
        }
        let mut previous: Option<&[u8]> = None;
        for company in &seat.companies {
            let id = company.fictional_company_id.as_slice();
            if id.len() != 16 || id.iter().all(|byte| *byte == 0) {
                return Err(DecisionWireError::InvalidId);
            }
            if previous.is_some_and(|value| value >= id) {
                return Err(DecisionWireError::InvalidCompanyOrder);
            }
            previous = Some(id);
        }
    }
    Ok(())
}

/// Validates canonical shape of a kernel output before it can be committed.
///
/// # Errors
///
/// Rejects wrong versions, digest widths, action order, enum values, and a
/// company/direction shape that would make `NO_ACTION` ambiguous.
pub fn validate_decision_output_v1(
    output: &game::v1::DecisionKernelOutputV1,
) -> Result<(), DecisionWireError> {
    if output.schema_version != 1 {
        return Err(DecisionWireError::UnsupportedSchema);
    }
    if output.algorithm_digest.len() != 32
        || output.input_digest.len() != 32
        || output.kernel_abi_digest.len() != 32
    {
        return Err(DecisionWireError::InvalidDigest);
    }
    if output.actions.len() != 5 {
        return Err(DecisionWireError::InvalidSeatCount);
    }
    for (action, expected_seat_id) in output.actions.iter().zip(1_i32..=5) {
        if action.seat_id != expected_seat_id {
            return Err(DecisionWireError::InvalidSeatOrder);
        }
        if action.character_id.len() != 16 || action.seed_reference.len() != 32 {
            return Err(DecisionWireError::InvalidId);
        }
        let direction = game::v1::Direction::try_from(action.direction)
            .map_err(|_| DecisionWireError::InvalidDirection)?;
        match direction {
            game::v1::Direction::NoAction if action.fictional_company_id.is_empty() => {}
            game::v1::Direction::Upside | game::v1::Direction::Downside
                if action.fictional_company_id.len() == 16 => {}
            game::v1::Direction::Unspecified
            | game::v1::Direction::NoAction
            | game::v1::Direction::Upside
            | game::v1::Direction::Downside => {
                return Err(DecisionWireError::InvalidActionShape);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        CanonicalDecodeError, DecisionWireError, canonical_bytes, canonical_digest,
        decode_canonical,
        game::v1::{CompanyActionInputV1, DecisionKernelInputV1, Placement, SeatDecisionInputV1},
        validate_decision_input_v1,
    };

    #[test]
    fn canonical_placement_encoding_is_pinned() {
        let placement = Placement {
            seat_id: 1,
            character_id: vec![1; 16],
            dossier_id: vec![11; 16],
        };
        let mut expected_bytes = vec![0x08, 0x01, 0x12, 0x10];
        expected_bytes.extend([1; 16]);
        expected_bytes.extend([0x1a, 0x10]);
        expected_bytes.extend([11; 16]);

        assert_eq!(canonical_bytes(&placement), expected_bytes);
        assert_eq!(
            canonical_digest(b"PSZS/PLACEMENT/v1\0", &placement),
            [
                0xee, 0x31, 0xf2, 0x6e, 0xcf, 0xf1, 0x81, 0x9b, 0xde, 0x3f, 0x85, 0x9b, 0x67, 0x26,
                0xcc, 0x40, 0x46, 0xfe, 0xe0, 0x9a, 0x75, 0xe1, 0x78, 0x1a, 0x48, 0xea, 0x92, 0x81,
                0x2f, 0x81, 0xd3, 0xc2,
            ]
        );
    }

    #[test]
    fn non_canonical_unknown_fields_are_rejected() {
        let placement = Placement {
            seat_id: 1,
            character_id: vec![1; 16],
            dossier_id: vec![11; 16],
        };
        let mut bytes = canonical_bytes(&placement);
        bytes.extend([0xa0, 0x06, 0x01]);
        assert_eq!(
            decode_canonical::<Placement>(&bytes),
            Err(CanonicalDecodeError::NonCanonicalBytes)
        );
    }

    #[test]
    fn domain_ordering_is_validated_beyond_protobuf_encoding() {
        let companies: Vec<CompanyActionInputV1> = [2_u8, 1, 3, 4]
            .into_iter()
            .map(|id| CompanyActionInputV1 {
                fictional_company_id: vec![id; 16],
                ..CompanyActionInputV1::default()
            })
            .collect();
        let seats = (0_u8..5)
            .map(|index| SeatDecisionInputV1 {
                seat_id: i32::from(index) + 1,
                character_id: vec![index + 1; 16],
                companies: companies.clone(),
                qmax_fixed: 1_000_000,
                resistance_fixed: 1,
                tie_break_seed: vec![index + 10; 32],
                ..SeatDecisionInputV1::default()
            })
            .collect();
        let input = DecisionKernelInputV1 {
            schema_version: 1,
            algorithm_digest: vec![1; 32],
            snapshot_digest: vec![2; 32],
            decision_input_sealed_event_id: vec![3; 16],
            decision_session_version: 1,
            decision_session_id: vec![4; 16],
            round_id: vec![5; 16],
            content_session_id: vec![6; 16],
            logical_cell_id: vec![7; 16],
            ownership_epoch: 1,
            seats,
            kernel_abi_digest: vec![8; 32],
        };
        assert_eq!(
            validate_decision_input_v1(&input),
            Err(DecisionWireError::InvalidCompanyOrder)
        );
    }
}
