//! `MemoryLedger` (`docs/v5/system-design.md` §4 Memory bounded context),
//! scoped to episodic memory formation only. `MemoryReframed`/`MemoryLinked`/
//! `MemorySalienceChanged`/`MemoryVisibilityChanged` are declared as
//! canonical events in `docs/v5/contracts/canonical-owner-map.yaml` but are
//! not yet wire- or domain-modeled here -- see the implementation report's
//! gap list. `current belief` and `BeliefRevised` are never owned here (they
//! stay on `CharacterLife` per the owner map); this module only ever
//! *references* the character, never mutates its belief state.

use crate::{Digest, Id};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MemoryKind {
    Episodic,
    Belief,
    RelationshipMemory,
    SelfNarrative,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MemoryVisibility {
    CanonicalRestricted,
    SubscriberArchive,
    PublicEdition,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MemoryLedgerError {
    DuplicateMemoryId,
    UnknownMemoryId,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MemoryRecord {
    pub memory_id: Id,
    pub character_id: Id,
    pub kind: MemoryKind,
    pub source_event_digest: Digest,
    pub formed_at_unix_micros: i64,
    pub salience_bp: i32,
    pub confidence_bp: i32,
    pub valence_bp: i32,
    pub visibility: MemoryVisibility,
}

/// A single character's memory ledger. Kept intentionally small (a `Vec`
/// scan, not an index) -- the one-character slice forms at most a handful of
/// memories; a production-scale ledger would need salience-bucketed
/// retrieval, which is out of scope here.
#[derive(Clone, Debug, Eq, PartialEq, Default)]
pub struct MemoryLedger {
    records: Vec<MemoryRecord>,
}

impl MemoryLedger {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            records: Vec::new(),
        }
    }

    /// `MemoryFormed`. Source events are never overwritten
    /// (`docs/v5/character-story-engine.md` "記憶": "事件本身不可覆蓋").
    ///
    /// # Errors
    ///
    /// Rejects a duplicate `memory_id`.
    pub fn form(&mut self, record: MemoryRecord) -> Result<(), MemoryLedgerError> {
        if self.records.iter().any(|existing| existing.memory_id == record.memory_id) {
            return Err(MemoryLedgerError::DuplicateMemoryId);
        }
        self.records.push(record);
        Ok(())
    }

    #[must_use]
    pub fn find(&self, memory_id: Id) -> Option<&MemoryRecord> {
        self.records.iter().find(|record| record.memory_id == memory_id)
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.records.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::{MemoryKind, MemoryLedger, MemoryLedgerError, MemoryRecord, MemoryVisibility};

    fn record(memory_id: u8) -> MemoryRecord {
        MemoryRecord {
            memory_id: [memory_id; 16],
            character_id: [9; 16],
            kind: MemoryKind::Episodic,
            source_event_digest: [1; 32],
            formed_at_unix_micros: 1_000,
            salience_bp: 6_000,
            confidence_bp: 8_000,
            valence_bp: -2_000,
            visibility: MemoryVisibility::CanonicalRestricted,
        }
    }

    #[test]
    fn duplicate_memory_id_is_rejected() {
        let mut ledger = MemoryLedger::new();
        ledger.form(record(1)).expect("first memory");
        assert_eq!(ledger.form(record(1)), Err(MemoryLedgerError::DuplicateMemoryId));
        assert_eq!(ledger.len(), 1);
    }

    #[test]
    fn distinct_memories_accumulate() {
        let mut ledger = MemoryLedger::new();
        ledger.form(record(1)).expect("first");
        ledger.form(record(2)).expect("second");
        assert_eq!(ledger.len(), 2);
        assert!(ledger.find([2; 16]).is_some());
    }
}
