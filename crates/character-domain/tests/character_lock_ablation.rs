//! Character lock: in one bounded scene, removing any single factor
//! (personality, natal chart, memory, emotion, relationship) moves only the
//! component slots that factor owns, and moves at least one outcome -- the
//! attention order or the chosen action. Every score goes through the real
//! frozen kernel (`attention_score`, `action_utility_v1`) via
//! `assembly::rank_attention` / `assembly::select_action`.
//!
//! Scope: this proves the assembly + kernel path. The one-character slice's
//! own actions are still frozen by its script; deriving them from this
//! assembly is later work.

use panshi_character_domain::{
    assembly::{
        ActionCandidate, ActionPull, AttentionCandidate, BloodTypeTone, CharacterFactor,
        CharacterFactors, CharacterProfile, FactDomain, HabitFluency, NatalMotif, Personality,
        RelationshipPull, SkillProficiency, TriggerableMemory, assemble_action, assemble_attention,
        rank_attention, select_action,
    },
    character::{DynamicState, FourAxisPreference},
    cognition::ActionKind,
};
use panshi_decision_kernel::{
    Fixed,
    character_action::{ActionUtilityComponents, AttentionComponents},
};

const DECIDED_AT: i64 = 1_772_500_000_000_000;
const COLLEAGUE: &str = "acq-colleague";

const SKILLS: [SkillProficiency; 2] = [
    SkillProficiency {
        domain: FactDomain::Filing,
        proficiency_bp: 7_000,
    },
    SkillProficiency {
        domain: FactDomain::PriceTape,
        proficiency_bp: 3_000,
    },
];

const HABITS: [HabitFluency; 2] = [
    HabitFluency {
        action: ActionKind::ReadOrVerify,
        fluency_bp: 6_000,
    },
    HabitFluency {
        action: ActionKind::Wait,
        fluency_bp: 2_000,
    },
];

const MEMORIES: [TriggerableMemory<'static>; 2] = [
    // Missing an opening move: brought back by momentum, pulls toward buying.
    TriggerableMemory {
        memory_id: [1; 16],
        cue_tag: "momentum",
        salience_bp: 6_000,
        pull: Some(ActionPull {
            action: ActionKind::PaperBuy,
            pull_bp: 5_000,
        }),
    },
    // Being teased for waiting: brought back by recognition, pulls away
    // from waiting.
    TriggerableMemory {
        memory_id: [2; 16],
        cue_tag: "recognition",
        salience_bp: 4_000,
        pull: Some(ActionPull {
            action: ActionKind::Wait,
            pull_bp: -3_000,
        }),
    },
];

fn full_factors() -> CharacterFactors<'static> {
    CharacterFactors {
        personality: Personality {
            four_axis: FourAxisPreference {
                social_orientation_bp: -3_600,
                information_orientation_bp: 2_200,
                decision_orientation_bp: 4_800,
                closure_orientation_bp: 1_400,
            },
            skills: &SKILLS,
            habits: &HABITS,
        },
        natal_motif: Some(NatalMotif {
            motif_id: "control_and_recognition",
            theme_tags: &["recognition", "control"],
            strength_bp: 2_000,
            expires_at_unix_micros: DECIDED_AT + 1,
        }),
        memories: &MEMORIES,
        emotion: DynamicState {
            valence_bp: -1_200,
            arousal_bp: 0,
            stress_bp: 3_000,
            fatigue_bp: 0,
            confidence_bp: 3_000,
            fomo_bp: 4_600,
            uncertainty_load_bp: 4_800,
        },
        relationship: Some(RelationshipPull {
            counterpart_ref: COLLEAGUE,
            source_trust_bp: 6_000,
            impulse: Some(ActionPull {
                action: ActionKind::PaperBuy,
                pull_bp: 4_000,
            }),
        }),
    }
}

const fn fact(
    fact_revision_id: &'static str,
    domain: FactDomain,
    cue_tags: &'static [&'static str],
    source_ref: Option<&'static str>,
    core_appraisal_bp: i32,
    goal_relevance_bp: i32,
) -> AttentionCandidate<'static> {
    AttentionCandidate {
        fact_revision_id,
        domain,
        cue_tags,
        source_ref,
        evaluated_at_unix_micros: DECIDED_AT,
        core_appraisal_bp,
        goal_relevance_bp,
        scene_accessibility_bp: 10_000,
        seeded_tie_noise_bp: 0,
    }
}

const FACTS: [AttentionCandidate<'static>; 4] = [
    fact(
        "fact-price-move",
        FactDomain::PriceTape,
        &["momentum", "price"],
        None,
        5_000,
        6_000,
    ),
    fact(
        "fact-peer-inventory",
        FactDomain::Filing,
        &["inventory"],
        None,
        6_000,
        3_000,
    ),
    fact(
        "fact-colleague-remark",
        FactDomain::SocialRemark,
        &["momentum"],
        Some(COLLEAGUE),
        3_000,
        4_000,
    ),
    fact(
        "fact-title-change",
        FactDomain::PriceTape,
        &["recognition"],
        None,
        3_500,
        4_500,
    ),
];

const fn candidate(
    action: ActionKind,
    evidence_fit_bp: i32,
    goal_fit_bp: i32,
    cost_bp: i32,
) -> ActionCandidate {
    ActionCandidate {
        action,
        evidence_fit_bp,
        goal_fit_bp,
        pattern_activation_bp: 0,
        cost_bp,
    }
}

const ACTIONS: [ActionCandidate; 4] = [
    candidate(ActionKind::Wait, 2_000, 1_000, 0),
    candidate(ActionKind::ReadOrVerify, 3_000, 2_000, 0),
    candidate(ActionKind::PaperBuy, 3_000, 3_000, 500),
    candidate(ActionKind::PaperSell, 1_000, 0, 500),
];

const ATTENTION_FIELDS: [&str; 8] = [
    "core_appraisal",
    "current_goal_and_need",
    "occupation_skill_and_existing_focus",
    "memory_trigger",
    "social_transmission_and_source_trust",
    "natal_symbolic_motif",
    "scene_accessibility",
    "seeded_tie_noise",
];

const ACTION_FIELDS: [&str; 7] = [
    "evidence_and_belief_fit",
    "current_goal_and_need_fit",
    "dynamic_emotion_and_agency",
    "activated_memory",
    "relationship_impulse",
    "cognitive_pattern_activation",
    "habit_and_skill_fluency",
];

const fn attention_values(components: AttentionComponents) -> [Fixed; 8] {
    [
        components.core_appraisal,
        components.current_goal_and_need,
        components.occupation_skill_and_existing_focus,
        components.memory_trigger,
        components.social_transmission_and_source_trust,
        components.natal_symbolic_motif,
        components.scene_accessibility,
        components.seeded_tie_noise,
    ]
}

const fn action_values(components: ActionUtilityComponents) -> [Fixed; 7] {
    [
        components.evidence_and_belief_fit,
        components.current_goal_and_need_fit,
        components.dynamic_emotion_and_agency,
        components.activated_memory,
        components.relationship_impulse,
        components.cognitive_pattern_activation,
        components.habit_and_skill_fluency,
    ]
}

/// The expected mapping, written out independently of `assembly.rs` so a
/// change there that re-routes a factor fails here.
fn owned_slots(factor: CharacterFactor) -> (&'static [&'static str], &'static [&'static str]) {
    match factor {
        CharacterFactor::Personality => (
            &["occupation_skill_and_existing_focus"],
            &["habit_and_skill_fluency"],
        ),
        CharacterFactor::NatalChart => (&["natal_symbolic_motif"], &[]),
        CharacterFactor::Memory => (&["memory_trigger"], &["activated_memory"]),
        CharacterFactor::Emotion => (&[], &["dynamic_emotion_and_agency"]),
        CharacterFactor::Relationship => (
            &["social_transmission_and_source_trust"],
            &["relationship_impulse"],
        ),
    }
}

#[derive(Debug, PartialEq, Eq)]
struct Outcome {
    attention_order: Vec<&'static str>,
    action: ActionKind,
}

fn outcome(factors: &CharacterFactors<'static>) -> Outcome {
    let ranked = rank_attention(factors, &FACTS).expect("bounded scene ranks");
    let (action, _) = select_action(factors, &ACTIONS).expect("bounded scene chooses");
    Outcome {
        attention_order: ranked.into_iter().map(|(id, _)| id).collect(),
        action,
    }
}

/// Asserts the ablation moved only the factor's own slots, moved each of
/// them for at least one candidate (so the check is not vacuous), and moved
/// at least one outcome.
fn assert_attributable(factor: CharacterFactor) {
    let full = full_factors();
    let ablated = full.without(factor);
    let (attention_owned, action_owned) = owned_slots(factor);

    let mut attention_moved = [false; 8];
    for candidate in &FACTS {
        let before = attention_values(assemble_attention(&full, candidate));
        let after = attention_values(assemble_attention(&ablated, candidate));
        for (index, field) in ATTENTION_FIELDS.iter().enumerate() {
            if before[index] != after[index] {
                assert!(
                    attention_owned.contains(field),
                    "{factor:?} ablation moved attention slot {field} on {}",
                    candidate.fact_revision_id
                );
                attention_moved[index] = true;
            }
        }
    }
    let mut action_moved = [false; 7];
    for candidate in &ACTIONS {
        let before = action_values(assemble_action(&full, candidate));
        let after = action_values(assemble_action(&ablated, candidate));
        for (index, field) in ACTION_FIELDS.iter().enumerate() {
            if before[index] != after[index] {
                assert!(
                    action_owned.contains(field),
                    "{factor:?} ablation moved action slot {field} on {:?}",
                    candidate.action
                );
                action_moved[index] = true;
            }
        }
    }
    for (index, field) in ATTENTION_FIELDS.iter().enumerate() {
        if attention_owned.contains(field) {
            assert!(
                attention_moved[index],
                "{factor:?} never moved its own slot {field}"
            );
        }
    }
    for (index, field) in ACTION_FIELDS.iter().enumerate() {
        if action_owned.contains(field) {
            assert!(
                action_moved[index],
                "{factor:?} never moved its own slot {field}"
            );
        }
    }

    let before = outcome(&full);
    let after = outcome(&ablated);
    assert!(
        before.attention_order != after.attention_order || before.action != after.action,
        "{factor:?} ablation left both the attention order and the chosen action unchanged: {before:?}"
    );
}

#[test]
fn full_scene_baseline_is_what_the_ablations_are_measured_against() {
    assert_eq!(
        outcome(&full_factors()),
        Outcome {
            attention_order: vec![
                "fact-price-move",
                "fact-peer-inventory",
                "fact-title-change",
                "fact-colleague-remark",
            ],
            action: ActionKind::PaperBuy,
        }
    );
}

#[test]
fn ablate_personality_changes_only_its_components_and_an_outcome() {
    assert_attributable(CharacterFactor::Personality);
}

#[test]
fn ablate_natal_chart_changes_only_its_components_and_an_outcome() {
    assert_attributable(CharacterFactor::NatalChart);
}

#[test]
fn ablate_memory_changes_only_its_components_and_an_outcome() {
    assert_attributable(CharacterFactor::Memory);
}

#[test]
fn ablate_emotion_changes_only_its_components_and_an_outcome() {
    assert_attributable(CharacterFactor::Emotion);
}

#[test]
fn ablate_relationship_changes_only_its_components_and_an_outcome() {
    assert_attributable(CharacterFactor::Relationship);
}

#[test]
fn natal_chart_ablation_leaves_action_utility_components_untouched() {
    let full = full_factors();
    let ablated = full.without(CharacterFactor::NatalChart);
    // The motif is live in this scene: it does move attention...
    assert!(FACTS.iter().any(|candidate| {
        assemble_attention(&full, candidate).natal_symbolic_motif
            != assemble_attention(&ablated, candidate).natal_symbolic_motif
    }));
    // ...and never any action-utility component, nor the chosen action or
    // its utility.
    for candidate in &ACTIONS {
        assert_eq!(
            assemble_action(&full, candidate),
            assemble_action(&ablated, candidate)
        );
    }
    assert_eq!(
        select_action(&full, &ACTIONS),
        select_action(&ablated, &ACTIONS)
    );
}

#[test]
fn blood_type_has_zero_market_term() {
    let profile = |code: &'static str, social_tone_bp: i32| CharacterProfile {
        factors: full_factors(),
        blood_type: BloodTypeTone {
            code,
            social_tone_bp,
        },
    };
    let o = profile("O", 300);
    let a = profile("A", -200);
    let uncapped = profile("B", 9_000);
    // Blood type is live in its own channel (and capped there)...
    assert_ne!(o.social_tone_bp(), a.social_tone_bp());
    assert_eq!(uncapped.social_tone_bp(), 300);
    // ...and contributes nothing to any market component.
    for other in [&a, &uncapped] {
        for candidate in &FACTS {
            assert_eq!(o.attention(candidate), other.attention(candidate));
        }
        for candidate in &ACTIONS {
            assert_eq!(o.action(candidate), other.action(candidate));
        }
    }
}

#[test]
fn same_factors_same_outcome_every_run() {
    let factors = full_factors();
    let first_ranked = rank_attention(&factors, &FACTS).expect("ranks");
    let first_choice = select_action(&factors, &ACTIONS).expect("chooses");
    for _ in 0..100 {
        assert_eq!(
            rank_attention(&factors, &FACTS).expect("ranks"),
            first_ranked
        );
        assert_eq!(
            select_action(&factors, &ACTIONS).expect("chooses"),
            first_choice
        );
    }
}

#[test]
fn empty_candidate_sets_fail_closed() {
    use panshi_character_domain::assembly::AssemblyError;
    let factors = full_factors();
    assert_eq!(
        rank_attention(&factors, &[]),
        Err(AssemblyError::NoCandidates)
    );
    assert_eq!(
        select_action(&factors, &[]),
        Err(AssemblyError::NoCandidates)
    );
    let mut unnamed = FACTS[0];
    unnamed.fact_revision_id = "";
    assert_eq!(
        rank_attention(&factors, &[unnamed]),
        Err(AssemblyError::MissingFactRevisionId)
    );
}
