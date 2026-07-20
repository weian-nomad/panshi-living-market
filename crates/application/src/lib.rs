#![forbid(unsafe_code)]

//! Production-shaped application boundary for HTTP, workers, and bootstrap.

use panshi_domain::{
    round_desk::{RoundDesk, RoundDeskError, SavedSeatPlan, SealedSeatPlan},
    seat::{CharacterId, DossierId, Placement, SeatId, SeatPlan, SeatPlanError},
};
use panshi_decision_kernel::{ALGORITHM_ID, KERNEL_ABI};
use panshi_protocol::{canonical_bytes, decode_canonical, domain_digest, game::v1};
use prost::Message;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

pub mod projection;

pub const ROUND_STREAM: &str = "RoundDesk";
pub const DECISION_STREAM: &str = "DecisionSession";
pub const INPUT_TAG: &[u8] = b"PSZS/DECISION_INPUT/v1\0";
pub const ALGORITHM_TAG: &[u8] = b"PSZS/ALGORITHM_BUNDLE/v1\0";
pub const KERNEL_ABI_TAG: &[u8] = b"PSZS/KERNEL_ABI/v1\0";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiPlacement {
    pub seat_id: String,
    pub character_id: Uuid,
    pub dossier_id: Uuid,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSeatPlanBody {
    pub base_version: u64,
    pub layout_digest: String,
    pub placements: Vec<ApiPlacement>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SealSeatPlanBody {
    pub canonical_version: u64,
    pub layout_digest: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandReceipt {
    pub command_id: Uuid,
    pub disposition: String,
    pub canonical_version: u64,
    pub retryable: bool,
    pub reason_code: Option<String>,
    pub status_resource: String,
}

#[derive(Clone, Debug)]
pub struct LoadedRound {
    pub desk: RoundDesk,
    pub decision_session_id: [u8; 16],
    pub content_session_id: [u8; 16],
    pub content_revision_id: [u8; 16],
    pub evidence_cutoff_unix_micros: i64,
}

#[derive(Clone, Debug)]
pub struct ContentRevision {
    pub revision_id: [u8; 16],
    pub payload: Value,
    pub digest: [u8; 32],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ApplicationError {
    NotFound,
    InvalidId,
    InvalidDigest,
    InvalidPlacement,
    CorruptHistory,
    Persistence,
}

impl From<SeatPlanError> for ApplicationError {
    fn from(_: SeatPlanError) -> Self {
        Self::InvalidPlacement
    }
}

impl From<RoundDeskError> for ApplicationError {
    fn from(_: RoundDeskError) -> Self {
        Self::CorruptHistory
    }
}

pub fn parse_uuid(value: &str) -> Result<[u8; 16], ApplicationError> {
    value
        .parse::<Uuid>()
        .map(|parsed| *parsed.as_bytes())
        .map_err(|_| ApplicationError::InvalidId)
}

pub fn uuid(value: [u8; 16]) -> Uuid {
    Uuid::from_bytes(value)
}

pub fn parse_digest(value: &str) -> Result<[u8; 32], ApplicationError> {
    if value.len() != 64 {
        return Err(ApplicationError::InvalidDigest);
    }
    let mut digest = [0; 32];
    for (index, byte) in digest.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16)
            .map_err(|_| ApplicationError::InvalidDigest)?;
    }
    Ok(digest)
}

pub fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut value = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        value.push(char::from(DIGITS[usize::from(byte >> 4)]));
        value.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    value
}

pub fn seat_id(value: &str) -> Result<SeatId, ApplicationError> {
    match value {
        "gatekeeper" => Ok(SeatId::Gatekeeper),
        "core-a" => Ok(SeatId::CoreA),
        "core-b" => Ok(SeatId::CoreB),
        "flank" => Ok(SeatId::Flank),
        "explore" => Ok(SeatId::Explore),
        _ => Err(ApplicationError::InvalidPlacement),
    }
}

pub fn proto_seat_id(value: SeatId) -> i32 {
    value as i32 + 1
}

pub fn seat_plan(placements: &[ApiPlacement]) -> Result<SeatPlan, ApplicationError> {
    let mapped = placements
        .iter()
        .map(|placement| {
            Ok(Placement {
                seat_id: seat_id(&placement.seat_id)?,
                character_id: CharacterId(*placement.character_id.as_bytes()),
                dossier_id: DossierId(*placement.dossier_id.as_bytes()),
            })
        })
        .collect::<Result<Vec<_>, ApplicationError>>()?;
    let array: [Placement; 5] = mapped
        .try_into()
        .map_err(|_| ApplicationError::InvalidPlacement)?;
    SeatPlan::new(array)
    .map_err(Into::into)
}

pub fn save_command_bytes(
    round_id: [u8; 16],
    body: &SaveSeatPlanBody,
) -> Result<(SeatPlan, [u8; 32], Vec<u8>), ApplicationError> {
    let plan = seat_plan(&body.placements)?;
    let digest = parse_digest(&body.layout_digest)?;
    if plan.layout_digest() != digest {
        return Err(ApplicationError::InvalidDigest);
    }
    let message = v1::SaveSeatPlan {
        round_id: round_id.to_vec(),
        base_version: body.base_version,
        layout_digest: digest.to_vec(),
        placements: plan
            .placements()
            .iter()
            .map(|placement| v1::Placement {
                seat_id: proto_seat_id(placement.seat_id),
                character_id: placement.character_id.0.to_vec(),
                dossier_id: placement.dossier_id.0.to_vec(),
            })
            .collect(),
    };
    Ok((plan, digest, canonical_bytes(&message)))
}

pub fn command_digest(kind: &str, command_bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"PSZS/COMMAND/v1\0");
    hasher.update((kind.len() as u64).to_be_bytes());
    hasher.update(kind.as_bytes());
    hasher.update(command_bytes);
    hasher.finalize().into()
}

pub fn algorithm_digest() -> [u8; 32] {
    let policy = include_bytes!("../../../contracts/policy/decision-v1.json");
    let mut preimage = Vec::new();
    for section in [ALGORITHM_ID.as_bytes(), KERNEL_ABI.as_bytes(), policy.as_slice()] {
        preimage.extend(u64::try_from(section.len()).unwrap_or(u64::MAX).to_be_bytes());
        preimage.extend(section);
    }
    domain_digest(ALGORITHM_TAG, &preimage)
}

pub fn kernel_abi_digest() -> [u8; 32] {
    domain_digest(KERNEL_ABI_TAG, KERNEL_ABI.as_bytes())
}

pub fn build_decision_input(
    loaded: &LoadedRound,
    content: &ContentRevision,
    decision_input_event_id: [u8; 16],
    decision_session_version: u64,
) -> Result<(v1::DecisionKernelInputV1, [u8; 32]), ApplicationError> {
    let plan = loaded
        .desk
        .saved_plan
        .as_ref()
        .ok_or(ApplicationError::CorruptHistory)?;
    let dossiers = content.payload["dossiers"]
        .as_array()
        .ok_or(ApplicationError::CorruptHistory)?;
    let seats = content.payload["seats"]
        .as_array()
        .ok_or(ApplicationError::CorruptHistory)?;
    let mut snapshot_hasher = Sha256::new();
    snapshot_hasher.update(b"PSZS/DECISION_SNAPSHOT/v1\0");
    snapshot_hasher.update(content.digest);
    snapshot_hasher.update(plan.layout_digest);
    snapshot_hasher.update(loaded.desk.stream_version.to_be_bytes());
    let snapshot_digest: [u8; 32] = snapshot_hasher.finalize().into();
    let algorithm = algorithm_digest();
    let kernel = kernel_abi_digest();

    let mut wire_seats = Vec::with_capacity(5);
    for (index, placement) in plan.plan.placements().iter().enumerate() {
        let dossier_id = uuid(placement.dossier_id.0).to_string();
        let dossier = dossiers
            .iter()
            .find(|value| value["id"] == dossier_id)
            .ok_or(ApplicationError::CorruptHistory)?;
        let mut companies = dossier["companies"]
            .as_array()
            .ok_or(ApplicationError::CorruptHistory)?
            .iter()
            .map(|company| {
                let company_id = parse_uuid(
                    company["id"]
                        .as_str()
                        .ok_or(ApplicationError::CorruptHistory)?,
                )?;
                let scores = synthetic_scores(
                    placement.character_id.0,
                    placement.dossier_id.0,
                    company_id,
                );
                Ok(v1::CompanyActionInputV1 {
                    fictional_company_id: company_id.to_vec(),
                    upside_conviction_fixed: scores.0,
                    downside_conviction_fixed: scores.1,
                    upside_allowed: true,
                    downside_allowed: true,
                })
            })
            .collect::<Result<Vec<_>, ApplicationError>>()?;
        companies.sort_unstable_by(|left, right| {
            left.fictional_company_id.cmp(&right.fictional_company_id)
        });
        let qmax = parse_fixed(
            seats
                .get(index)
                .and_then(|seat| seat["qmax"].as_str())
                .ok_or(ApplicationError::CorruptHistory)?,
        )?;
        let mut seed_hasher = Sha256::new();
        seed_hasher.update(b"PSZS/SEAT_SEED/v1\0");
        seed_hasher.update(snapshot_digest);
        seed_hasher.update([u8::try_from(index).map_err(|_| ApplicationError::CorruptHistory)?]);
        seed_hasher.update(placement.character_id.0);
        seed_hasher.update(placement.dossier_id.0);
        let seed: [u8; 32] = seed_hasher.finalize().into();
        wire_seats.push(v1::SeatDecisionInputV1 {
            seat_id: i32::try_from(index + 1).map_err(|_| ApplicationError::CorruptHistory)?,
            character_id: placement.character_id.0.to_vec(),
            companies,
            qmax_fixed: qmax,
            resistance_fixed: 800_000
                + i64::try_from(index).map_err(|_| ApplicationError::CorruptHistory)? * 100_000,
            no_action_utility_fixed: if qmax == 0 { 150_000 } else { 40_000 },
            tie_break_seed: seed.to_vec(),
        });
    }
    let input = v1::DecisionKernelInputV1 {
        schema_version: 1,
        algorithm_digest: algorithm.to_vec(),
        snapshot_digest: snapshot_digest.to_vec(),
        decision_input_sealed_event_id: decision_input_event_id.to_vec(),
        decision_session_version,
        decision_session_id: loaded.decision_session_id.to_vec(),
        round_id: loaded.desk.round_id.to_vec(),
        content_session_id: loaded.content_session_id.to_vec(),
        logical_cell_id: loaded.desk.logical_cell_id.to_vec(),
        ownership_epoch: loaded.desk.ownership_epoch,
        seats: wire_seats,
        kernel_abi_digest: kernel.to_vec(),
    };
    panshi_protocol::validate_decision_input_v1(&input)
        .map_err(|_| ApplicationError::CorruptHistory)?;
    let input_digest = domain_digest(INPUT_TAG, &canonical_bytes(&input));
    Ok((input, input_digest))
}

fn synthetic_scores(
    character_id: [u8; 16],
    dossier_id: [u8; 16],
    company_id: [u8; 16],
) -> (i64, i64) {
    let mut hasher = Sha256::new();
    hasher.update(b"PSZS/SYNTHETIC_APPRAISAL/v1\0");
    hasher.update(character_id);
    hasher.update(dossier_id);
    hasher.update(company_id);
    let digest: [u8; 32] = hasher.finalize().into();
    let first = u32::from_be_bytes(digest[0..4].try_into().unwrap_or([0; 4]));
    let second = u32::from_be_bytes(digest[4..8].try_into().unwrap_or([0; 4]));
    (
        i64::from(first % 1_600_001) - 800_000,
        i64::from(second % 1_600_001) - 800_000,
    )
}

fn parse_fixed(value: &str) -> Result<i64, ApplicationError> {
    let (whole, fraction) = value
        .split_once('.')
        .ok_or(ApplicationError::CorruptHistory)?;
    if fraction.len() != 6 {
        return Err(ApplicationError::CorruptHistory);
    }
    let whole = whole
        .parse::<i64>()
        .map_err(|_| ApplicationError::CorruptHistory)?;
    let fraction = fraction
        .parse::<i64>()
        .map_err(|_| ApplicationError::CorruptHistory)?;
    whole
        .checked_mul(1_000_000)
        .and_then(|value| value.checked_add(fraction))
        .ok_or(ApplicationError::CorruptHistory)
}

pub async fn database_now_unix_micros(pool: &PgPool) -> Result<i64, ApplicationError> {
    sqlx::query_scalar::<_, i64>(
        "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000000)::bigint",
    )
    .fetch_one(pool)
    .await
    .map_err(|_| ApplicationError::Persistence)
}

pub async fn load_content(
    pool: &PgPool,
    revision_id: [u8; 16],
) -> Result<ContentRevision, ApplicationError> {
    let row: Option<(Vec<u8>, Vec<u8>)> = sqlx::query_as(
        "SELECT payload_bytes, payload_digest FROM content.revisions WHERE revision_id = $1",
    )
    .bind(uuid(revision_id))
    .fetch_optional(pool)
    .await
    .map_err(|_| ApplicationError::Persistence)?;
    let (bytes, digest) = row.ok_or(ApplicationError::NotFound)?;
    Ok(ContentRevision {
        revision_id,
        payload: serde_json::from_slice(&bytes).map_err(|_| ApplicationError::CorruptHistory)?,
        digest: digest
            .try_into()
            .map_err(|_| ApplicationError::CorruptHistory)?,
    })
}

pub async fn load_round(
    pool: &PgPool,
    round_id: [u8; 16],
) -> Result<LoadedRound, ApplicationError> {
    let rows: Vec<(String, Vec<u8>, i64, Uuid)> = sqlx::query_as(
        "SELECT event_type, payload_bytes, stream_version, event_id \
         FROM event_store.events \
         WHERE stream_type = 'RoundDesk' AND stream_id = $1 \
         ORDER BY stream_version",
    )
    .bind(uuid(round_id))
    .fetch_all(pool)
    .await
    .map_err(|_| ApplicationError::Persistence)?;
    if rows.is_empty() {
        return Err(ApplicationError::NotFound);
    }

    let mut opened: Option<v1::HistoricalRoundOpened> = None;
    let mut saved: Option<SavedSeatPlan> = None;
    let mut sealed: Option<SealedSeatPlan> = None;
    let mut last_version = 0_u64;
    for (event_type, payload, stream_version, event_id) in rows {
        last_version = u64::try_from(stream_version).map_err(|_| ApplicationError::CorruptHistory)?;
        match event_type.as_str() {
            "HistoricalRoundOpened" => {
                opened = Some(
                    decode_canonical::<v1::HistoricalRoundOpened>(&payload)
                        .map_err(|_| ApplicationError::CorruptHistory)?,
                );
            }
            "SeatPlanSaved" => {
                let event = decode_canonical::<v1::SeatPlanSaved>(&payload)
                    .map_err(|_| ApplicationError::CorruptHistory)?;
                let plan = proto_plan(&event.placements)?;
                saved = Some(SavedSeatPlan {
                    plan,
                    layout_digest: fixed::<32>(&event.layout_digest)?,
                    saved_event_id: *event_id.as_bytes(),
                    stream_version: last_version,
                });
            }
            "SeatPlanSealed" => {
                let event = decode_canonical::<v1::SeatPlanSealed>(&payload)
                    .map_err(|_| ApplicationError::CorruptHistory)?;
                sealed = Some(SealedSeatPlan {
                    round_id: fixed::<16>(&event.round_id)?,
                    content_session_id: fixed::<16>(&event.content_session_id)?,
                    logical_cell_id: opened
                        .as_ref()
                        .map(|value| fixed::<16>(&value.logical_cell_id))
                        .transpose()?
                        .ok_or(ApplicationError::CorruptHistory)?,
                    ownership_epoch: opened
                        .as_ref()
                        .map_or(0, |value| value.ownership_epoch),
                    layout_digest: fixed::<32>(&event.layout_digest)?,
                    sealed_event_id: *event_id.as_bytes(),
                    stream_version: last_version,
                    database_committed_at_unix_micros: event.database_committed_at_unix_micros,
                });
            }
            _ => {}
        }
    }
    let opened = opened.ok_or(ApplicationError::CorruptHistory)?;
    let logical_cell_id = fixed::<16>(&opened.logical_cell_id)?;
    let desk = RoundDesk::rehydrate(
        round_id,
        logical_cell_id,
        opened.ownership_epoch,
        last_version,
        opened.interaction_cutoff_unix_micros,
        saved,
        sealed,
    )?;
    Ok(LoadedRound {
        desk,
        decision_session_id: fixed::<16>(&opened.decision_session_id)?,
        content_session_id: fixed::<16>(&opened.content_session_id)?,
        content_revision_id: fixed::<16>(&opened.content_revision_id)?,
        evidence_cutoff_unix_micros: opened.evidence_cutoff_unix_micros,
    })
}

fn proto_plan(placements: &[v1::Placement]) -> Result<SeatPlan, ApplicationError> {
    let mapped = placements
        .iter()
        .map(|placement| {
            Ok(Placement {
                seat_id: match placement.seat_id {
                    1 => SeatId::Gatekeeper,
                    2 => SeatId::CoreA,
                    3 => SeatId::CoreB,
                    4 => SeatId::Flank,
                    5 => SeatId::Explore,
                    _ => return Err(ApplicationError::CorruptHistory),
                },
                character_id: CharacterId(fixed::<16>(&placement.character_id)?),
                dossier_id: DossierId(fixed::<16>(&placement.dossier_id)?),
            })
        })
        .collect::<Result<Vec<_>, ApplicationError>>()?;
    let array: [Placement; 5] = mapped
        .try_into()
        .map_err(|_| ApplicationError::CorruptHistory)?;
    SeatPlan::new(array)
    .map_err(|_| ApplicationError::CorruptHistory)
}

pub fn fixed<const N: usize>(bytes: &[u8]) -> Result<[u8; N], ApplicationError> {
    bytes
        .try_into()
        .map_err(|_| ApplicationError::CorruptHistory)
}

pub fn encode_message(message: &impl Message) -> Vec<u8> {
    canonical_bytes(message)
}
