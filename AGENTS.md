# Panshi Living Market rules

This repository is the canonical source for 《盤勢・市中人》, an autonomous-character market observation game. Read this file before changing product rules, user-facing copy, data contracts, design, code, deployment, model behavior, or financial content.

## Read order

1. `docs/game-product-proposal.md`
2. `docs/game-technical-architecture.md`
3. `docs/repository-boundary.md`
4. `docs/figjam-current-state.md`
5. The linked FigJam for flow changes

If the artifacts conflict, product rules win. Update the product spec first, then architecture, FigJam, tests, and implementation in the same change.

## Product invariants

- Characters are fictional adults. Real-world inputs may constrain aggregate distributions, historical context, and public events, but cannot identify or imitate a real person.
- The player may change what a character sees or questions. The player cannot choose a security, direction, price, quantity, leverage, stop, or exit for the character.
- Astrology, four-axis personality preferences, blood type, memories, relationships, and state may affect attention and interpretation. They cannot affect price data, hidden information access, or expected paper performance.
- Every visible claim carries one `truth_class`: `real_fact`, `statistical_sample`, `fictional_setting`, `symbolic_interpretation`, or `simulated_narrative`.
- Missing, stale, conflicting, unlicensed, or unsealed facts fail closed. A model failure is saved for review and never published as a completed event.
- Beta accounts receive `beta_full_access`. Payments, ads, trial countdowns, and store SDKs stay disabled until a later reviewed release.

## Repository boundary

- The separate Panshi market-research repository owns market ingestion, company-chart research, source licensing, fact revision, manifest sealing, and daily evidence videos.
- This repository owns game identity, characters, memories, relationships, weekly slots, world events, commons, game entitlements, and game clients.
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
- No paper-performance leaderboard, model-performance claim, guaranteed outcome, urgency around a security, or monetized access to earlier market information.
- Current-market character actions remain disabled until source rights, delay rules, Taiwan legal review, and signal-confusion testing all pass.
- Product disclaimers support the interaction design; they do not repair an unsafe feature. Change the feature when a flow can be read as a buy or sell instruction.

## Design and copy

- Use Traditional Chinese for product-facing Taiwan copy. Follow the workspace `copy-taste` routing rules before drafting or editing public text.
- The visual direction is adult, tactile, and legible: ink black, aged paper, restrained copper, and one cool market-data accent. Avoid casino cues, neon-fintech dashboards, decorative particles, and generic AI gradients.
- Every component needs loading, empty, stale, error, held-for-review, offline, reduced-motion, keyboard, screen-reader, and narrow/wide layout states where applicable.
- Generated character art needs a reproducible prompt, seed or source record, usage approval, crop-safe masters, motion layers, and a non-animated fallback.

## Engineering workflow

- The implementation is a pnpm/Turborepo modular monolith with explicit package boundaries. Apps depend on packages; domain code does not depend on frameworks or infrastructure adapters.
- Use exact production dependency versions and committed lockfiles. Add a dependency only with license, maintenance, runtime impact, and removal notes.
- Contract, replay, property, policy, accessibility, visual, migration, security, and failure-injection tests are release gates.
- Do not deploy or add recurring schedules from a product-code task unless the user explicitly requests production operation.
- Keep public docs free of live hosts, private runbooks, credential locations, user counts that are not approved for disclosure, and vendor details that reveal non-public capacity.
