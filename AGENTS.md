# Panshi Living Market rules

This repository is the canonical source for 《盤勢・眾生》, a reality-synced AI character world. Read this file before changing product rules, user-facing copy, data contracts, design, code, deployment, model behavior, or financial content.

## Read order

1. `docs/v3/product-reset.md`
2. `docs/v3/execution-handoff.md`
3. `docs/v3/user-journey.md`
4. `docs/v3/visual-system.md`
5. `docs/v3/competitive-reset.md`
6. `.agents/product-marketing.md`
7. `docs/repository-boundary.md`

The V2 product constitution, architecture, event catalog, client contract, user journey, backlog, tests, and current implementation are superseded historical material until V3 replacements exist. They may supply implementation techniques, but cannot define the product. If artifacts conflict, `docs/v3/product-reset.md` wins. Update the V3 product basis first, then derive architecture, FigJam, tests, and implementation. Rejected drafts remain in Git history and must not be restored as active specifications.

## Product invariants

- Characters are fictional adults. Real-world inputs may constrain aggregate distributions, historical context, and public events, but cannot identify or imitate a real person.
- The public world is the primary surface. Market events are the shared physical layer; characters and their continuing lives are the visible subject.
- A player is an observatory keeper with at most five active care slots. The player may provide bounded resources, questions, introductions, and one daily note. The player cannot choose a character's final company, stance, confidence, price, position, leverage, stop, or exit.
- Characters continue while the player is away. Relationship, memory, and life changes are canonical and cannot be rerolled after a market result.
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
- Current-market public events are a core V3 product input. External release still requires source rights, Taiwan legal review, an approved operating path, and signal-confusion testing; failure of a gate disables the affected event or public projection, not the character-world architecture.
- Product disclaimers support the interaction design; they do not repair an unsafe feature. Change the feature when a flow can be read as a buy or sell instruction.

## Design and copy

- Use Traditional Chinese for product-facing Taiwan copy. Follow the workspace `copy-taste` routing rules before drafting or editing public text.
- The visual direction is adult, tactile, and legible: ink black, aged paper, restrained copper, and one cool market-data accent. Avoid casino cues, neon-fintech dashboards, decorative particles, and generic AI gradients.
- Every component needs loading, empty, stale, error, held-for-review, offline, reduced-motion, keyboard, screen-reader, and narrow/wide layout states where applicable.
- Generated character art needs a reproducible prompt, seed or source record, usage approval, crop-safe masters, motion layers, and a non-animated fallback.

## Engineering workflow

- V2 architecture documents are not approved for V3. Do not extend the five-seat server loop until a V3 world-simulation and observation architecture is derived from `docs/v3/product-reset.md`.
- Prototypes may use disposable presentation code, but domain contracts, fixtures, and simulations must stay framework-independent and must not silently become production architecture.
- Use exact production dependency versions and committed lockfiles. Add a dependency only with license, maintenance, runtime impact, and removal notes.
- Contract, replay, property, policy, accessibility, visual, migration, security, and failure-injection tests are release gates.
- Do not deploy or add recurring schedules from a product-code task unless the user explicitly requests production operation.
- Keep public docs free of live hosts, private runbooks, credential locations, user counts that are not approved for disclosure, and vendor details that reveal non-public capacity.
