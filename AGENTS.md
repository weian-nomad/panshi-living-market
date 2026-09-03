# Panshi Living Market rules

This repository is the canonical source for 《盤勢・眾生》, a market-driven persistent character world. Read this file before changing product rules, user-facing copy, data contracts, design, code, deployment, model behavior, or financial content.

## Read order

1. `docs/v5/product-constitution.md`
2. `docs/v5/market-safety.md`
3. `docs/v5/experience-spec.md`
4. `docs/v5/character-story-engine.md`
5. `docs/v5/system-design.md`
6. `docs/v5/visual-system.md`
7. `docs/v5/delivery-plan.md`
8. `docs/v5/competitive-synthesis.md`
9. `.agents/product-marketing.md`
10. `docs/repository-boundary.md`

V2 and V3 product documents are rejected historical material. V4 is retained only as follow-camera and controlled-study research; it does not define the final information architecture, character depth, business model, or visual direction. If artifacts conflict, `docs/v5/product-constitution.md` wins.

## Product invariants

- Characters are fictional adults. Real-world inputs may constrain aggregate distributions, historical context, and public events, but cannot identify or imitate a real person.
- The public world is the primary discovery surface. It must lead naturally through follow-camera and character close-up into a full character life journal and deep archive.
- Paper holdings, P&L, trades, missed actions, drawdown, original reasons, later excuses, relationships, memories, and history are required character evidence. Do not remove them to make the product look less financial; place them at the correct story depth.
- A viewer is a camera operator. An entitled introducer may create up to five residents per week, select a model core at creation, and use the three bounded scene interventions defined in V5. There are no free-form prompts, trading instructions, resource buffs, personality editing, rerolls, or omniscient replay.
- Characters continue while the viewer is away. Relationship, memory, and life changes are canonical and cannot be rerolled after a market result.
- Astrology, four-axis personality preferences, blood type, memories, relationships, cognitive biases, life pressure, and state affect attention, interpretation, emotion, social behavior, and paper action. They cannot alter price data, hidden-information access, or expected paper performance directly.
- Characters need recognizable fallible patterns such as FOMO, anchoring, sunk-cost escalation, disposition effect, blame, self-attribution, and narrative switching. These patterns must arise from state and history, not random jokes or a visible “leek score.”
- Every visible claim carries one `truth_class`: `real_fact`, `statistical_sample`, `fictional_setting`, `symbolic_interpretation`, or `simulated_narrative`.
- Missing, stale, conflicting, unlicensed, or unsealed facts fail closed. A model failure is preserved for review and enters the versioned deterministic fallback path; it can never trigger retries until a more favorable action appears.
- Beta accounts receive `beta_full_access`. Payments, ads, trial countdowns, and store SDKs stay disabled until a later reviewed release.

## Repository boundary

- The separate Panshi market-research repository owns market ingestion, company-chart research, source licensing, fact revision, manifest sealing, and daily evidence videos.
- This repository owns game identity, characters, memories, relationships, introducer rights, world simulation, paper actions and ledgers, public story projections, character life-journal projections, game entitlements, and game clients.
- Consume market evidence only through a released, versioned sealed-fact contract and authenticated immutable artifacts. Never query the upstream database, mount its SQLite files, import its app packages, or add it as a Git submodule.
- Shared login or subscription status must travel through a documented external API or token contract. Do not share auth tables or session cookies across codebases by accident.
- Public code uses capability aliases. Do not name private infrastructure, credential paths, unpublished providers, or operational hosts.

## Data, AI, and privacy

- Store exact model, prompt, policy, rule, source, schema, and artifact versions for every generated event.
- A model may render approved structured state into prose. It does not set prices, choose evidence outside the allowlist, write directly to projections, or decide whether output passes policy.
- Private notes stay in a separate encrypted path and never enter analytics, model prompts, public projections, or observability payloads.
- Deletion and export are product flows, not manual database operations. Preserve a non-identifying audit skeleton after crypto-shredding subject data.
- Keep secrets in the company key vault or approved runtime secret store. Never commit `.env` files, tokens, credentials, logs, runtime databases, private exports, generated media, or user data.
- Heavy generation and rendering run on approved remote capacity, not on this coordination Mac.

## Finance and legal safety

- Treat all market content as cultural research and fictional paper simulation. Do not add calls to action that resemble personalized trading advice.
- No global paper-performance leaderboard, model-performance claim, guaranteed outcome, urgency around a security, or monetized access to earlier market information. Individual character performance and complete losses remain visible in the life journal.
- Current-market public events are a core V5 product input. External release still requires source rights, Taiwan legal review, an approved operating path, and signal-confusion testing; failure of a gate disables the affected event or public projection, not the character-world architecture.
- Product disclaimers support the interaction design; they do not repair an unsafe feature. Change the feature when a flow can be read as a buy or sell instruction.

## Design and copy

- Use Traditional Chinese for product-facing Taiwan copy. Follow the workspace `copy-taste` routing rules before drafting or editing public text.
- The visual direction is cute, adult, spatial, and legible: high-quality 2.5D residents, ink black, warm paper, oxidized copper, and one cool market-data signal. Avoid cold financial terminals, infantile chibi, casino cues, decorative particle fields, and generic AI gradients.
- Character fallibility should appear first through posture, gaze, objects, timing, changed words, and relationships. Product copy may be wry, but must not humiliate a character or reduce them to a strategy skin.
- Every component needs loading, empty, stale, error, held-for-review, offline, reduced-motion, keyboard, screen-reader, and narrow/wide layout states where applicable.
- Generated character art needs a reproducible prompt, seed or source record, usage approval, crop-safe masters, motion layers, and a non-animated fallback.

## Engineering workflow

- V2/V3 architecture concepts and the V4 study presentation do not define V5. Reuse contracts only when `docs/v5/system-design.md` explicitly adopts them; replace five-seat scoring, study-only state, and follow-camera assumptions that conflict with the persistent character world.
- Follow-camera remains one interaction adapter. It cannot be the only navigation or prevent a character life journal, paper ledger, relationship history, natal chart, memory, or timeline from existing.
- Prototypes may use disposable presentation code, but domain contracts, fixtures, ledgers, replay, and simulations must stay framework-independent and must not silently become production architecture.
- Use exact production dependency versions and committed lockfiles. Add a dependency only with license, maintenance, runtime impact, and removal notes.
- Contract, replay, property, policy, accessibility, visual, migration, security, and failure-injection tests are release gates.
- Do not deploy or add recurring schedules from a product-code task unless the user explicitly requests production operation.
- Keep public docs free of live hosts, private runbooks, credential locations, user counts that are not approved for disclosure, and vendor details that reveal non-public capacity.
