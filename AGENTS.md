# Panshi Living Market rules

This repository is the canonical source for 《盤勢・眾生》, a market-driven interactive reality show. Read this file before changing product rules, user-facing copy, data contracts, design, code, deployment, model behavior, or financial content.

## Read order

1. `docs/v4/product-north-star.md`
2. `docs/v4/interaction-prototype.md`
3. `docs/v4/research-reset.md`
4. `.agents/product-marketing.md`
5. `docs/repository-boundary.md`

V2 and V3 product documents are rejected historical material. They may explain past mistakes or supply implementation techniques, but cannot define the product. If artifacts conflict, `docs/v4/product-north-star.md` wins. V4 is not architecture-frozen: the ten-minute interaction prototype must pass its kill metrics before a production world architecture is derived.

## Product invariants

- Characters are fictional adults. Real-world inputs may constrain aggregate distributions, historical context, and public events, but cannot identify or imitate a real person.
- The public world is the primary surface. Market events are environmental pressure; characters and their continuing lives are the visible subject.
- A viewer is a live camera operator and, when entitled, a character introducer. The viewer may choose whom to follow and may select a model core only at character creation. There are no care actions, chat prompts, trading instructions, resource buffs, or omniscient replay.
- Characters continue while the viewer is away. Relationship, memory, and life changes are canonical and cannot be rerolled after a market result.
- Astrology, four-axis personality preferences, blood type, memories, relationships, and state may affect attention and interpretation. They cannot affect price data, hidden information access, or expected paper performance.
- Every visible claim carries one `truth_class`: `real_fact`, `statistical_sample`, `fictional_setting`, `symbolic_interpretation`, or `simulated_narrative`.
- Missing, stale, conflicting, unlicensed, or unsealed facts fail closed. A model failure is preserved for review and enters the versioned deterministic fallback path; it can never trigger retries until a more favorable action appears.
- Beta accounts receive `beta_full_access`. Payments, ads, trial countdowns, and store SDKs stay disabled until a later reviewed release.

## Repository boundary

- The separate Panshi market-research repository owns market ingestion, company-chart research, source licensing, fact revision, manifest sealing, and daily evidence videos.
- This repository owns game identity, characters, memories, relationships, care rights, world simulation, simulated actions, public story projections, game entitlements, and game clients.
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
- No global paper-performance leaderboard, model-performance claim, guaranteed outcome, urgency around a security, or monetized access to earlier market information.
- Current-market public events are a core V4 product input. External release still requires source rights, Taiwan legal review, an approved operating path, and signal-confusion testing; failure of a gate disables the affected event or public projection, not the character-world architecture.
- Product disclaimers support the interaction design; they do not repair an unsafe feature. Change the feature when a flow can be read as a buy or sell instruction.

## Design and copy

- Use Traditional Chinese for product-facing Taiwan copy. Follow the workspace `copy-taste` routing rules before drafting or editing public text.
- The visual direction is adult, spatial, and legible: ink black, grey-blue natural light, old-paper white, oxidized copper, and one cool market-data signal. Avoid casino cues, black-gold dashboards, decorative particle fields, and generic AI gradients.
- Every component needs loading, empty, stale, error, held-for-review, offline, reduced-motion, keyboard, screen-reader, and narrow/wide layout states where applicable.
- Generated character art needs a reproducible prompt, seed or source record, usage approval, crop-safe masters, motion layers, and a non-animated fallback.

## Engineering workflow

- V2 and V3 architecture concepts do not define V4. Do not extend the five-seat loop, WorldNode schedule, care system, daily-main-story projection, or trace-puzzle concept. Build the disposable ten-minute follow-camera prototype first.
- Prototypes may use disposable presentation code, but domain contracts, fixtures, and simulations must stay framework-independent and must not silently become production architecture.
- Use exact production dependency versions and committed lockfiles. Add a dependency only with license, maintenance, runtime impact, and removal notes.
- Contract, replay, property, policy, accessibility, visual, migration, security, and failure-injection tests are release gates.
- Do not deploy or add recurring schedules from a product-code task unless the user explicitly requests production operation.
- Keep public docs free of live hosts, private runbooks, credential locations, user counts that are not approved for disclosure, and vendor details that reveal non-public capacity.
