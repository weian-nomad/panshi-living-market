# Panshi Living Market rules

This repository is the canonical source for 《盤勢・眾生》, an autonomous-character market strategy game. Read this file before changing product rules, user-facing copy, data contracts, design, code, deployment, model behavior, or financial content.

## Read order

1. `docs/product-constitution.md`
2. `docs/architecture/architecture-constitution.md`
3. `docs/architecture/event-catalog.md`
4. `docs/architecture/state-payload-map.md`
5. `docs/architecture/client-contract.md`
6. `docs/repository-boundary.md`
7. `docs/design/visual-system-brief.md`
8. `docs/ux/user-journey.md`
9. `BACKLOG.md`

If the artifacts conflict, the product constitution wins. Update it first, then architecture, FigJam, tests, and implementation in the same change. Rejected drafts remain in Git history and must not be restored as active specifications.

## Product invariants

- Characters are fictional adults. Real-world inputs may constrain aggregate distributions, historical context, and public events, but cannot identify or imitate a real person.
- The player uses `排席` to place five unique characters and five dossiers, fixed for one five-valid-trading-day round, on five predefined desks. Desk order determines one-pass social input. The player cannot choose a character's final company, stance, confidence position, price, leverage, stop, or exit.
- Astrology, four-axis personality preferences, blood type, memories, relationships, and state may affect attention and interpretation. They cannot affect price data, hidden information access, or expected paper performance.
- Every visible claim carries one `truth_class`: `real_fact`, `statistical_sample`, `fictional_setting`, `symbolic_interpretation`, or `simulated_narrative`.
- Missing, stale, conflicting, unlicensed, or unsealed facts fail closed. A model failure is preserved for review and enters the versioned deterministic fallback path; it can never trigger retries until a more favorable action appears.
- Beta accounts receive `beta_full_access`. Payments, ads, trial countdowns, and store SDKs stay disabled until a later reviewed release.

## Repository boundary

- The separate Panshi market-research repository owns market ingestion, company-chart research, source licensing, fact revision, manifest sealing, and daily evidence videos.
- This repository owns game identity, characters, memories, relationships, five-seat configuration, sealed decisions, division play, delayed public projections, game entitlements, and game clients.
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
- No global paper-performance leaderboard, model-performance claim, guaranteed outcome, urgency around a security, or monetized access to earlier market information. The proposed competition is a bounded eight-player division whose rules must pass legal and incentive review.
- Public v1 uses isolated historical seasons with fictional company names and masked dates. Current-market character actions remain a separate disabled mode until source rights, Taiwan legal review, an approved operating path, and signal-confusion testing all pass.
- Product disclaimers support the interaction design; they do not repair an unsafe feature. Change the feature when a flow can be read as a buy or sell instruction.

## Design and copy

- Use Traditional Chinese for product-facing Taiwan copy. Follow the workspace `copy-taste` routing rules before drafting or editing public text.
- The visual direction is adult, tactile, and legible: ink black, aged paper, restrained copper, and one cool market-data accent. Avoid casino cues, neon-fintech dashboards, decorative particles, and generic AI gradients.
- Every component needs loading, empty, stale, error, held-for-review, offline, reduced-motion, keyboard, screen-reader, and narrow/wide layout states where applicable.
- Generated character art needs a reproducible prompt, seed or source record, usage approval, crop-safe masters, motion layers, and a non-animated fallback.

## Engineering workflow

- The approved stack and topology live in `docs/architecture/architecture-constitution.md`. Do not restore the deleted city/world-day architecture or add a second source of truth.
- Prototypes may use disposable presentation code, but domain contracts, fixtures, and simulations must stay framework-independent and must not silently become production architecture.
- Use exact production dependency versions and committed lockfiles. Add a dependency only with license, maintenance, runtime impact, and removal notes.
- Contract, replay, property, policy, accessibility, visual, migration, security, and failure-injection tests are release gates.
- Do not deploy or add recurring schedules from a product-code task unless the user explicitly requests production operation.
- Keep public docs free of live hosts, private runbooks, credential locations, user counts that are not approved for disclosure, and vendor details that reveal non-public capacity.
