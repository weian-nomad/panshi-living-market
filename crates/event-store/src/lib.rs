#![forbid(unsafe_code)]

//! Append-only event-store port and canonical append types.
//!
//! Domain crates do not depend on this crate. Adapters must commit canonical
//! events, stream heads, command deduplication, and outbox rows atomically.

pub type Id = [u8; 16];
pub type Digest = [u8; 32];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ModeDomain {
    Historical,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamPrecondition {
    pub logical_cell_id: Id,
    pub stream_type: String,
    pub stream_id: Id,
    pub expected_version: u64,
    pub ownership_epoch: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NewEvent {
    pub event_id: Id,
    pub event_type: String,
    pub schema_version: u32,
    pub stream_type: String,
    pub stream_id: Id,
    pub logical_cell_id: Id,
    pub ownership_epoch: u64,
    pub mode_domain: ModeDomain,
    pub causation_id: Id,
    pub correlation_id: Id,
    pub trace_id: String,
    pub actor_bytes: Vec<u8>,
    pub occurred_at_unix_micros: i64,
    pub policy_revision: String,
    pub model_revision: Option<String>,
    pub fact_revision: Option<String>,
    pub engine_artifact_digest: Option<Digest>,
    pub rights_scope: String,
    pub data_class: String,
    pub visibility_epoch: u64,
    pub payload_bytes: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AppendRequest {
    pub command_id: Id,
    pub command_owner: String,
    pub idempotency_key: String,
    pub command_digest: Digest,
    pub preconditions: Vec<StreamPrecondition>,
    pub events: Vec<NewEvent>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EventReceipt {
    pub event_id: Id,
    pub stream_version: u64,
    pub global_position: u64,
    pub payload_hash: Digest,
    pub event_hash: Digest,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AppendReceipt {
    pub command_id: Id,
    pub deduplicated: bool,
    pub events: Vec<EventReceipt>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CommandState {
    Pending,
    Committed,
    Rejected,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommandRegistration {
    pub command_id: Id,
    pub command_owner: String,
    pub idempotency_key: String,
    pub command_kind: String,
    pub command_bytes: Vec<u8>,
    pub request_hash: Digest,
    pub status_resource: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommandRecord {
    pub command_id: Id,
    pub command_kind: String,
    pub command_bytes: Vec<u8>,
    pub request_hash: Digest,
    pub state: CommandState,
    pub is_replay: bool,
    pub canonical_version: Option<u64>,
    pub retryable: bool,
    pub reason_code: Option<String>,
    pub status_resource: String,
    pub receipt_bytes: Option<Vec<u8>>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommandRejection {
    pub command_id: Id,
    pub command_owner: String,
    pub request_hash: Digest,
    pub canonical_version: u64,
    pub reason_code: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AppendError {
    EmptyBatch,
    DuplicateEventId,
    MissingPrecondition,
    VersionConflict {
        stream_type: String,
        stream_id: Id,
        expected: u64,
        actual: u64,
    },
    OwnershipEpochConflict,
    IdempotencyDigestConflict,
    CommandNotFound,
    CommandAlreadyRejected,
    NumericOutOfRange,
    Persistence,
}

pub trait EventStore: Send + Sync {
    /// Durably records the exact versioned command before domain execution.
    fn register_command(
        &self,
        command: CommandRegistration,
    ) -> impl Future<Output = Result<CommandRecord, AppendError>> + Send;

    /// Freezes a deterministic domain rejection as a terminal journal result.
    fn reject_command(
        &self,
        rejection: CommandRejection,
    ) -> impl Future<Output = Result<CommandRecord, AppendError>> + Send;

    /// Reads the authoritative command lifecycle, independently of projections.
    fn command(
        &self,
        command_id: Id,
    ) -> impl Future<Output = Result<Option<CommandRecord>, AppendError>> + Send;

    /// Atomically appends every event or none of them.
    ///
    /// # Errors
    ///
    /// Returns a typed conflict for failed canonical preconditions and a
    /// persistence error for adapter failures. Retrying the same owner,
    /// idempotency key, and digest returns the original receipt.
    fn append(
        &self,
        request: AppendRequest,
    ) -> impl Future<Output = Result<AppendReceipt, AppendError>> + Send;
}

impl AppendRequest {
    #[must_use]
    pub fn registration(&self, command_bytes: Vec<u8>) -> CommandRegistration {
        CommandRegistration {
            command_id: self.command_id,
            command_owner: self.command_owner.clone(),
            idempotency_key: self.idempotency_key.clone(),
            command_kind: "canonical-event-append-v1".into(),
            command_bytes,
            request_hash: self.command_digest,
            status_resource: format!("/v1/commands/{}", uuid_text(self.command_id)),
        }
    }
}

fn uuid_text(bytes: Id) -> String {
    let hex = |value: u8| -> char {
        const DIGITS: &[u8; 16] = b"0123456789abcdef";
        char::from(DIGITS[usize::from(value)])
    };
    let mut value = String::with_capacity(36);
    for (index, byte) in bytes.into_iter().enumerate() {
        if matches!(index, 4 | 6 | 8 | 10) {
            value.push('-');
        }
        value.push(hex(byte >> 4));
        value.push(hex(byte & 0x0f));
    }
    value
}

/// Rejects malformed append batches before an adapter opens a transaction.
///
/// # Errors
///
/// Rejects empty batches, duplicate event IDs, and any event that lacks a
/// matching stream precondition.
pub fn validate_request(request: &AppendRequest) -> Result<(), AppendError> {
    if request.events.is_empty() {
        return Err(AppendError::EmptyBatch);
    }
    for right in 1..request.events.len() {
        for left in 0..right {
            if request.events[left].event_id == request.events[right].event_id {
                return Err(AppendError::DuplicateEventId);
            }
        }
    }
    for event in &request.events {
        if event.ownership_epoch > i64::MAX as u64 || event.visibility_epoch > i64::MAX as u64 {
            return Err(AppendError::NumericOutOfRange);
        }
        let has_precondition = request.preconditions.iter().any(|condition| {
            condition.logical_cell_id == event.logical_cell_id
                && condition.stream_type == event.stream_type
                && condition.stream_id == event.stream_id
                && condition.ownership_epoch == event.ownership_epoch
        });
        if !has_precondition {
            return Err(AppendError::MissingPrecondition);
        }
    }
    if request.preconditions.iter().any(|condition| {
        condition.expected_version > i64::MAX as u64
            || condition.ownership_epoch == 0
            || condition.ownership_epoch > i64::MAX as u64
    }) {
        return Err(AppendError::NumericOutOfRange);
    }
    Ok(())
}

mod postgres;

pub use postgres::PostgresEventStore;

#[cfg(test)]
mod tests {
    use super::{
        AppendError, AppendRequest, ModeDomain, NewEvent, StreamPrecondition, validate_request,
    };

    fn event(id: u8) -> NewEvent {
        NewEvent {
            event_id: [id; 16],
            event_type: "SeatPlanSaved".into(),
            schema_version: 1,
            stream_type: "RoundDesk".into(),
            stream_id: [2; 16],
            logical_cell_id: [3; 16],
            ownership_epoch: 4,
            mode_domain: ModeDomain::Historical,
            causation_id: [5; 16],
            correlation_id: [6; 16],
            trace_id: "trace-1".into(),
            actor_bytes: vec![7],
            occurred_at_unix_micros: 8,
            policy_revision: "policy/1".into(),
            model_revision: None,
            fact_revision: None,
            engine_artifact_digest: Some([9; 32]),
            rights_scope: "synthetic-fixture".into(),
            data_class: "fictional".into(),
            visibility_epoch: 10,
            payload_bytes: vec![11],
        }
    }

    fn request(events: Vec<NewEvent>) -> AppendRequest {
        AppendRequest {
            command_id: [1; 16],
            command_owner: "desk".into(),
            idempotency_key: "save-1".into(),
            command_digest: [12; 32],
            preconditions: vec![StreamPrecondition {
                logical_cell_id: [3; 16],
                stream_type: "RoundDesk".into(),
                stream_id: [2; 16],
                expected_version: 7,
                ownership_epoch: 4,
            }],
            events,
        }
    }

    #[test]
    fn rejects_an_empty_append() {
        assert_eq!(
            validate_request(&request(Vec::new())),
            Err(AppendError::EmptyBatch)
        );
    }

    #[test]
    fn rejects_duplicate_event_ids() {
        assert_eq!(
            validate_request(&request(vec![event(1), event(1)])),
            Err(AppendError::DuplicateEventId)
        );
    }

    #[test]
    fn accepts_a_fully_preconditioned_batch() {
        assert_eq!(validate_request(&request(vec![event(1)])), Ok(()));
    }
}
