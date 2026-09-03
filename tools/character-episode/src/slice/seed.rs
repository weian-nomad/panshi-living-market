//! 陸硯之's frozen character chassis for the one-character vertical slice.
//!
//! Every value here is the official worked example from
//! `docs/v5/character-story-engine.md` ("完整例子：陸硯之又追了進去") expressed
//! as `const` data, so the slice doubles as an executable acceptance script
//! for that specification. He is a fictional adult; nothing here identifies
//! or imitates a real person (`AGENTS.md`: "Characters are fictional
//! adults").
//!
//! Layer discipline, restated because it is the easiest thing to break:
//! natal motif, four-axis preferences, blood type, memories, and the one
//! relationship may only reach behaviour through attention, interpretation,
//! emotion, social conduct and paper action. None of them touches price
//! data, hidden-information access, or expected paper performance. The motif
//! has exactly one numeric route into the model -- the 800bp
//! `natal_symbolic_motif` slot of `AttentionWeights::V1` -- and
//! `ActionUtilityWeights::V1` has no natal term at all.

use panshi_character_domain::{
    character::FourAxisPreference,
    memory::{MemoryKind, MemoryVisibility},
};

/// `derive_id` tags. Ids are derived, not literal, so a rename of a tag is
/// visible as a changed stream id rather than silently reusing a stream.
pub const CHARACTER_TAG: &str = "v5-slice/character";
pub const PAPER_ACCOUNT_TAG: &str = "v5-slice/paper-account";
pub const PAPER_POSITION_TAG: &str = "v5-slice/paper-position";
pub const BUY_ORDER_TAG: &str = "v5-slice/paper-order/buy-s2";
pub const SELL_ORDER_TAG: &str = "v5-slice/paper-order/sell-s5";

pub const DISPLAY_NAME: &str = "陸硯之";
pub const AGE_YEARS: u32 = 28;
pub const BIRTH_DATE: &str = "1998-03-14";
pub const BIRTH_REGION: &str = "TW-synthetic";
pub const OCCUPATION_GROUP: &str = "corporate_research_assistant";
pub const INCOME_BAND: &str = "median";
pub const MODEL_CORE_ID: &str = "gemma4-26b";
pub const ORIGIN_SEED_COMMITMENT: &str = "seed-v5-slice-001";
pub const GENERATION_POLICY_REVISION: &str = "character-generation-policy/v1";
pub const STATISTICAL_PACK_REVISION: &str = "statistical-pack/v1";

pub const ATTENTION_POLICY_REVISION: &str = "attention-policy/v1";
pub const BEHAVIOR_POLICY_REVISION: &str = "behavior-policy/v1";
pub const STATE_POLICY_REVISION: &str = "character-state-policy/v1";
pub const MEMORY_DECAY_POLICY_REVISION: &str = "memory-decay-policy/v1";
pub const NARRATIVE_POLICY_REVISION: &str = "narrative-policy/v1";
pub const SEMANTIC_VERIFIER_REVISION: &str = "semantic-verifier/v1";
pub const SAFETY_POLICY_REVISION: &str = "safety-policy/v1";
pub const COGNITION_INPUT_SCHEMA_REVISION: &str = "cognition-appraisal/v1";
pub const UTTERANCE_OUTPUT_SCHEMA_REVISION: &str = "utterance-artifact/v1";
pub const LANGUAGE_TAG: &str = "zh-Hant-TW";
pub const AUDIENCE_SCOPE_PUBLIC: &str = "public_current";
pub const AUDIENCE_SCOPE_SELF: &str = "self_only";

/// 內省 68／抽象 61／分析 74／結構 57, expressed on the canonical
/// `-10_000..=10_000` basis-point axis.
pub const FOUR_AXIS: FourAxisPreference = FourAxisPreference {
    social_orientation_bp: -3_600,
    information_orientation_bp: 2_200,
    decision_orientation_bp: 4_800,
    closure_orientation_bp: 1_400,
};

pub const CORE_NEED_CODE: &str = "control";
pub const CORE_FEAR_CODE: &str = "public_ignorance_exposure";

// -- Natal motif -------------------------------------------------------------

/// 太陽天蠍／月亮雙子／上升摩羯 collapse into ONE symbolic motif for this
/// slice. `truth_class` is `SYMBOLIC_INTERPRETATION` wherever it is shown --
/// never `REAL_FACT`, and never a market claim.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NatalMotif {
    pub motif_id: &'static str,
    pub label: &'static str,
    pub strength_bp: i32,
    /// The motif stops carrying weight after S3's close. A symbolic theme
    /// with no expiry would quietly become a permanent personality buff.
    pub expires_at_unix_micros: i64,
}

/// S3 (2026-03-05) close, 13:30 Taipei.
pub const MOTIF_CONTROL_AND_RECOGNITION: NatalMotif = NatalMotif {
    motif_id: "control_and_recognition",
    label: "控制與認可",
    strength_bp: 2_000,
    expires_at_unix_micros: 1_772_688_600_000_000,
};

/// Blood type O affects self-description and social tone only, capped at
/// 300bp, and contributes exactly zero to any market-facing term.
pub const BLOOD_TYPE_CODE: &str = "O";
pub const BLOOD_TYPE_SOCIAL_TONE_CAP_BP: i32 = 300;
pub const BLOOD_TYPE_MARKET_TERM_BP: i32 = 0;

// -- Self-imposed exposure cap ------------------------------------------------

/// His own written exposure limit, well inside the account policy's 25%.
/// It is what makes "只是小部位" checkable: NT$100,000 against a NT$1,000,000
/// account is 82% of this self-imposed 12.2% cap.
pub const PERSONAL_EXPOSURE_CAP_BP: i32 = 1_220;

// -- Memories -----------------------------------------------------------------

/// A memory to seal, plus the quote-free life-bible note the journal renders
/// beside it. The note is an observable summary, never words put in his
/// mouth: only a sealed `UtteranceArtifact` may be quoted.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SeedMemory {
    pub tag: &'static str,
    pub kind: MemoryKind,
    pub salience_bp: i32,
    pub confidence_bp: i32,
    pub valence_bp: i32,
    pub visibility: MemoryVisibility,
    pub life_bible_note: &'static str,
}

/// 14 歲，父親的印刷廠突然關閉。The origin of the need for control.
pub const MEMORY_PRESS_SHOP_CLOSED: SeedMemory = SeedMemory {
    tag: "mem-001",
    kind: MemoryKind::Episodic,
    salience_bp: 8_200,
    confidence_bp: 8_800,
    valence_bp: -4_500,
    visibility: MemoryVisibility::SubscriberArchive,
    life_bible_note: "十四歲那年，父親的印刷廠在一週內關掉。",
};

/// 兩年前，一次「等資料等到錯過」之後被同事當面調侃。The historical source of
/// the FOMO reading -- not a random joke generator.
pub const MEMORY_TEASED_FOR_WAITING: SeedMemory = SeedMemory {
    tag: "mem-002",
    kind: MemoryKind::Episodic,
    salience_bp: 6_000,
    confidence_bp: 7_600,
    valence_bp: -2_000,
    visibility: MemoryVisibility::SubscriberArchive,
    life_bible_note: "兩年前他等資料等到錯過，被同事當著整組的面提起。",
};

/// 「我是靠證據做事的人」. The self-narrative S4's switch contradicts.
pub const MEMORY_I_WORK_FROM_EVIDENCE: SeedMemory = SeedMemory {
    tag: "mem-003",
    kind: MemoryKind::SelfNarrative,
    salience_bp: 7_000,
    confidence_bp: 8_000,
    valence_bp: 1_500,
    visibility: MemoryVisibility::SubscriberArchive,
    life_bible_note: "他對自己的說法是：靠證據做事的人。",
};

/// The three memories sealed at bootstrap, before any market session.
pub const ORIGIN_MEMORIES: [SeedMemory; 3] = [
    MEMORY_PRESS_SHOP_CLOSED,
    MEMORY_TEASED_FOR_WAITING,
    MEMORY_I_WORK_FROM_EVIDENCE,
];

/// S1: he was reading yesterday's footnotes while the move happened.
pub const MEMORY_MISSED_THE_OPENING_MOVE: SeedMemory = SeedMemory {
    tag: "mem-004",
    kind: MemoryKind::Episodic,
    salience_bp: 5_400,
    confidence_bp: 7_000,
    valence_bp: -3_000,
    visibility: MemoryVisibility::SubscriberArchive,
    life_bible_note: "他在補昨天的公告附註時，錯過了早盤那一段。",
};

/// S2: the position itself.
pub const MEMORY_OPENED_THE_POSITION: SeedMemory = SeedMemory {
    tag: "mem-005",
    kind: MemoryKind::Episodic,
    salience_bp: 6_600,
    confidence_bp: 8_200,
    valence_bp: 800,
    visibility: MemoryVisibility::SubscriberArchive,
    life_bible_note: "十點四十二分，他建立了紙上部位，然後才回頭補看昨天的材料。",
};

/// S4: the note whose title changed while the evidence did not.
pub const MEMORY_RETITLED_THE_NOTE: SeedMemory = SeedMemory {
    tag: "mem-006",
    kind: MemoryKind::Episodic,
    salience_bp: 5_800,
    confidence_bp: 7_400,
    valence_bp: -2_400,
    visibility: MemoryVisibility::SubscriberArchive,
    life_bible_note: "筆記標題從動能觀察改成長期治理價值，支持資料沒有增加。",
};

/// S5: the first admission, and the first time he reduced.
pub const MEMORY_FIRST_ADMISSION: SeedMemory = SeedMemory {
    tag: "mem-007",
    kind: MemoryKind::SelfNarrative,
    salience_bp: 7_400,
    confidence_bp: 8_000,
    valence_bp: -1_200,
    visibility: MemoryVisibility::SubscriberArchive,
    life_bible_note: "他第一次把「理由已經不成立」寫下來，然後才動手減碼。",
};

// -- Relationship --------------------------------------------------------------

/// 陳小雨: same team, he trusts her judgement and is afraid of being seen
/// through by her.
///
/// This slice has ONE character. There is no `RelationshipDyad` aggregate and
/// no sealed utterance of hers, so she may never be quoted and no line may be
/// written for her. She exists only as a life-bible node plus one-way
/// observable actions by him -- which is exactly what the failure table
/// prescribes: "寧可少一句，也不臨時補一段往事".
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AcquaintanceNode {
    pub acquaintance_id: &'static str,
    pub display_name: &'static str,
    pub relation_note: &'static str,
    /// Observable, one-way, quote-free. Indexed by the session it belongs to.
    pub observable_actions: [(usize, &'static str); 3],
}

pub const ACQUAINTANCE_XIAOYU: AcquaintanceNode = AcquaintanceNode {
    acquaintance_id: "acq-hist-001-xiaoyu",
    display_name: "陳小雨",
    relation_note: "同組同事。他信任她的判斷，也怕被她看穿。",
    observable_actions: [
        (2, "他把她的提醒滑掉，沒有回。"),
        (4, "他繞開她的座位。"),
        (5, "他主動走回她的座位旁。"),
    ],
};

#[cfg(test)]
mod tests {
    use super::{
        ACQUAINTANCE_XIAOYU, BLOOD_TYPE_MARKET_TERM_BP, FOUR_AXIS, MOTIF_CONTROL_AND_RECOGNITION,
        ORIGIN_MEMORIES, PERSONAL_EXPOSURE_CAP_BP,
    };
    use panshi_character_domain::memory::MemoryKind;
    use panshi_decision_kernel::character_action::AttentionWeights;

    #[test]
    fn four_axis_matches_the_documented_worked_example() {
        assert_eq!(FOUR_AXIS.social_orientation_bp, -3_600);
        assert_eq!(FOUR_AXIS.information_orientation_bp, 2_200);
        assert_eq!(FOUR_AXIS.decision_orientation_bp, 4_800);
        assert_eq!(FOUR_AXIS.closure_orientation_bp, 1_400);
    }

    /// The motif may not be able to outweigh evidence and goals even at full
    /// strength: its only numeric route is the fixed 800bp attention slot.
    ///
    /// These assertions are deliberately over constants -- that is the
    /// point. They exist so that raising the motif's strength, or widening
    /// the natal weight slot, fails a test instead of quietly turning a
    /// symbolic theme into a market edge.
    #[test]
    #[allow(clippy::assertions_on_constants)]
    fn the_natal_motif_can_never_outweigh_the_evidence_slot() {
        assert!(
            MOTIF_CONTROL_AND_RECOGNITION.strength_bp
                <= AttentionWeights::V1.natal_symbolic_motif_bp * 10
        );
        assert!(
            AttentionWeights::V1.natal_symbolic_motif_bp < AttentionWeights::V1.core_appraisal_bp
        );
        assert_eq!(BLOOD_TYPE_MARKET_TERM_BP, 0);
    }

    /// Also a deliberate constant guard: loosening his self-imposed cap
    /// would silently invalidate the "只是小部位" contradiction the close-up
    /// is built on.
    #[test]
    #[allow(clippy::assertions_on_constants)]
    fn the_self_imposed_cap_is_stricter_than_the_account_policy() {
        // 12.20% of simulated assets, against the account policy's 25%.
        assert!(PERSONAL_EXPOSURE_CAP_BP < 2_500);
        assert_eq!(PERSONAL_EXPOSURE_CAP_BP, 1_220);
    }

    #[test]
    fn origin_memories_carry_the_documented_shape() {
        assert_eq!(ORIGIN_MEMORIES.len(), 3);
        assert_eq!(ORIGIN_MEMORIES[0].salience_bp, 8_200);
        assert_eq!(ORIGIN_MEMORIES[0].valence_bp, -4_500);
        assert_eq!(ORIGIN_MEMORIES[1].salience_bp, 6_000);
        assert_eq!(ORIGIN_MEMORIES[1].valence_bp, -2_000);
        assert_eq!(ORIGIN_MEMORIES[2].kind, MemoryKind::SelfNarrative);
        assert_eq!(ORIGIN_MEMORIES[2].salience_bp, 7_000);
        assert_eq!(ORIGIN_MEMORIES[2].valence_bp, 1_500);
    }

    /// She is present as observable behaviour only. Nothing in this node may
    /// look like speech attributed to her.
    #[test]
    fn the_acquaintance_node_never_carries_quoted_speech() {
        for (_, action) in ACQUAINTANCE_XIAOYU.observable_actions {
            assert!(!action.contains('「'), "observable actions must be quote-free");
            assert!(!action.contains('」'), "observable actions must be quote-free");
        }
        assert_eq!(
            ACQUAINTANCE_XIAOYU
                .observable_actions
                .map(|(session_index, _)| session_index),
            [2, 4, 5]
        );
    }
}
