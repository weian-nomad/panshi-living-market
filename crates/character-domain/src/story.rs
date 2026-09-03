//! `StoryChapter` (`docs/v5/system-design.md` §4 Story Editorial bounded
//! context), scoped to composing and publishing one chapter from an
//! already-approved source set. `DailyMomentsEdition` (the 0-5-chapter daily
//! index) is out of scope for the one-character slice.

use crate::{Digest, Id};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StorySourceSet {
    pub chapter_id: Id,
    pub character_ids: Vec<Id>,
    pub source_event_ids: Vec<Id>,
    pub utterance_artifact_ids: Vec<Id>,
    pub source_set_digest: Digest,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StoryChapterState {
    Composed,
    Published,
    Superseded,
    Withdrawn,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StoryChapterError {
    WrongState,
    VersionConflict { expected: u64, actual: u64 },
    EmptySourceSet,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StoryChapter {
    pub chapter_id: Id,
    pub state: StoryChapterState,
    pub stream_version: u64,
    pub revision: u32,
    pub source_set: Option<StorySourceSet>,
}

impl StoryChapter {
    /// `StoryChapterComposed`. Refuses to compose a chapter with no
    /// canonical source events at all
    /// (`docs/v5/character-story-engine.md`: "每個 `StoryBeat` 的人物、時間、
    /// 動作與數字都有 canonical ref").
    ///
    /// # Errors
    ///
    /// Rejects an empty source event list.
    pub fn compose(chapter_id: Id, source_set: StorySourceSet) -> Result<Self, StoryChapterError> {
        if source_set.source_event_ids.is_empty() {
            return Err(StoryChapterError::EmptySourceSet);
        }
        Ok(Self {
            chapter_id,
            state: StoryChapterState::Composed,
            stream_version: 0,
            revision: 1,
            source_set: Some(source_set),
        })
    }

    /// `StoryChapterPublished`. Publication itself does not grant audience
    /// visibility -- Privacy／Visibility writes a separate
    /// `PublicVisibilityGranted`／`SubscriberArchiveVisibilityGranted` event
    /// in its own local transaction, and public projection requires both
    /// (`docs/v5/system-design.md` §5.3: "Public projection 必須同時引用
    /// chapter event 與 grant event，缺一不發布"). This aggregate only
    /// tracks the Story Editorial side.
    ///
    /// # Errors
    ///
    /// Rejects a stale version or a chapter not in `Composed` state.
    pub fn publish(&mut self, expected_version: u64) -> Result<(), StoryChapterError> {
        self.require_state_and_version(StoryChapterState::Composed, expected_version)?;
        self.state = StoryChapterState::Published;
        self.stream_version += 1;
        Ok(())
    }

    fn require_state_and_version(
        &self,
        required: StoryChapterState,
        expected_version: u64,
    ) -> Result<(), StoryChapterError> {
        if self.stream_version != expected_version {
            return Err(StoryChapterError::VersionConflict {
                expected: expected_version,
                actual: self.stream_version,
            });
        }
        if self.state != required {
            return Err(StoryChapterError::WrongState);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{StoryChapter, StoryChapterError, StoryChapterState, StorySourceSet};

    fn source_set() -> StorySourceSet {
        StorySourceSet {
            chapter_id: [1; 16],
            character_ids: vec![[2; 16]],
            source_event_ids: vec![[3; 16], [4; 16]],
            utterance_artifact_ids: vec![[5; 16]],
            source_set_digest: [6; 32],
        }
    }

    #[test]
    fn empty_source_set_is_rejected() {
        let mut empty = source_set();
        empty.source_event_ids.clear();
        assert_eq!(
            StoryChapter::compose([1; 16], empty),
            Err(StoryChapterError::EmptySourceSet)
        );
    }

    #[test]
    fn compose_then_publish_advances_state() {
        let mut chapter = StoryChapter::compose([1; 16], source_set()).expect("compose");
        assert_eq!(chapter.state, StoryChapterState::Composed);
        chapter.publish(0).expect("publish");
        assert_eq!(chapter.state, StoryChapterState::Published);
        assert_eq!(chapter.stream_version, 1);
    }
}
