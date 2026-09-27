# World fact manifest — historical v1

`WorldFactManifestHistoricalV1` is the sealed envelope for one **historical-mode**
(`modeDomain: "historical"`) market session. It exists because
[`../v1/schema.json`](../v1/schema.json) deliberately narrows itself to current
mode and says so in its own `modeDomain` description: *"Historical-mode manifests
are a separate contractVersion/modeDomain pair, not this schema."* This directory
is that pair.

The two contracts differ in **who produces the facts**, which is the only reason a
second contract is justified:

| | `../v1` (current) | `historical-v1` (this) |
| --- | --- | --- |
| Producer | the separate 盤勢公司市場研究 repository | this repository |
| Facts | licensed, real TW market session data | self-contained synthetic fixture |
| `provenanceClass` | n/a (upstream-owned) | `synthetic_fixture` (required const) |
| `truthClass` | per-fact, upstream-owned | `fictional_setting` (required const) |
| Fact revision ids | `sf_…` (upstream sealed-facts namespace) | `fact-…` (this repo's own fixture namespace) |
| Session ids | `mkts_…` | `session-…` |

Everything else — the top-level field set, the required list, the two-allowlist
split, the eligibility arithmetic, and the digest convention — is deliberately
identical to `../v1`, so a consumer written against the current-mode manifest
reads a historical one without a second code path.

## Why synthetic, never `real_fact`

`docs/v5/product-constitution.md` 「角色資料的五種身分」 gives every visible claim
exactly one `truth_class`. The prices, momentum note, peer-inventory observation
and correction notice in this directory were **written here**, not measured
anywhere; labelling them `real_fact`（真實資料）would be a false claim about their
provenance, and it would let a downstream projection present a made-up close as a
real market quote.

So `real_fact` is not merely discouraged here, it is **unrepresentable**: both
schemas pin `truthClass` to the const `fictional_setting`, and
`tools/world-fact-manifest-historical-audit.mjs` additionally walks every `const`
and `enum` in both schemas to assert `real_fact` is not an admissible value
anywhere. This matches the existing convention in
`fixtures/legacy-v2/episode-001/decision-input.json`, which pairs
`"mode": "historical"` with `"truthClass": "fictional_setting"`.

The `provenanceClass: "synthetic_fixture"` const carries the other half of the
statement: *where the number came from*, kept separate from *what kind of claim it
is*, so a future real historical feed cannot inherit this fixture's labels by
accident — it would need its own `provenanceClass` value and therefore its own
contract review.

## Files

| File | Purpose |
| --- | --- |
| `schema.json` | JSON Schema (draft 2020-12) for `WorldFactManifestHistoricalV1`. The `../v1` top-level shape plus `provenanceClass` and `truthClass`; `additionalProperties: false`. Does **not** reference the fact-revision schema; the manifest only carries revision ID lists. |
| `fact-revision.schema.json` | JSON Schema for one historical fact revision record. |
| `fixtures/synthetic-historical-001.json` | The thirty sealed session manifests `wfm_hist_001_s01`…`s30`. Every hash/digest is actually computed from the fixture's own content, not a placeholder. |
| `fixtures/synthetic-historical-001-fact-revisions.json` | The thirty-three fact revision records those manifests' ID lists reference, with their sealed payloads. |

`tools/world-fact-manifest-historical-audit.mjs` (repo root `tools/`) validates
both fixtures against both schemas, recomputes every hash/digest, and checks the
semantic rules below. Run it with `pnpm audit:world-fact-manifest-historical`, or
`node tools/world-fact-manifest-historical-audit.mjs --fix` to recompute and write
back the four derived fields (`manifestHash`, `objectHash`,
`interactionFactSetDigest`, `outcomeEvidenceSetDigest`) after editing a fixture.
`--fix` only ever rewrites those four derived values; every semantic assertion
still runs afterwards, so `--fix` can never turn a rule violation into a pass.

## The thirty sessions

`PSZS-DEMO` is a fictional instrument. Prices are TWD **minor units（分）further
scaled by 1,000,000**, i.e. the same `sealedPriceMinorUnitsFixed6` convention as
`contracts/openapi/public-v2.yaml`; NT$96.00 is `9_600_000_000`. No floating-point
literal appears anywhere in this contract, and the audit asserts that textually.

### A synthetic calendar, not an exchange calendar

The market dates follow `marketCalendarRevision: "synthetic-historical-calendar/v2"`:
thirty **consecutive weekdays** starting 2026-03-02, minus two **declared synthetic
market holidays**, 2026-04-03 and 2026-04-06. This calendar was written here for
the fixture. It does not claim to be, and must never be presented as, a real
exchange's trading calendar; a real historical feed would need its own calendar
revision and its own contract review. The audit pins the date list, rejects
weekends and the declared holidays, and asserts that every weekday skipped between
two adjacent sessions is one of the declared holidays.

The six original beats keep their original dates and closes (2026-03-02 96.00,
2026-03-03 100.00, 2026-03-05 93.50, 2026-03-10 91.60, 2026-03-17 88.20, and
2026-03-18, which is now a settled session); the trading days between and after
them are filled in.

| Manifest | Market date (Asia/Taipei) | Close | Finality | Publishes outcome evidence |
| --- | --- | --- | --- | --- |
| `wfm_hist_001_s01` | 2026-03-02 | 96.00 | accepted | yes |
| `wfm_hist_001_s02` | 2026-03-03 | 100.00 | accepted | yes |
| `wfm_hist_001_s03` | 2026-03-04 | 96.40 | accepted | yes |
| `wfm_hist_001_s04` | 2026-03-05 | 93.50 | accepted | yes |
| `wfm_hist_001_s05` | 2026-03-06 | 94.10 | accepted | yes |
| `wfm_hist_001_s06` | 2026-03-09 | 92.80 | accepted | yes |
| `wfm_hist_001_s07` | 2026-03-10 | 91.60 | accepted | yes |
| `wfm_hist_001_s08` | 2026-03-11 | 90.90 | accepted | yes |
| `wfm_hist_001_s09` | 2026-03-12 | 91.30 | accepted | yes |
| `wfm_hist_001_s10` | 2026-03-13 | 90.20 | accepted | yes |
| `wfm_hist_001_s11` | 2026-03-16 | 89.40 | accepted | yes |
| `wfm_hist_001_s12` | 2026-03-17 | 88.20 | accepted | yes |
| `wfm_hist_001_s13` | 2026-03-18 | 88.60 | accepted | yes |
| `wfm_hist_001_s14` | 2026-03-19 | 89.10 | accepted | yes |
| `wfm_hist_001_s15` | 2026-03-20 | 88.90 | accepted | yes |
| `wfm_hist_001_s16` | 2026-03-23 | 88.30 | accepted | yes |
| `wfm_hist_001_s17` | 2026-03-24 | 87.60 | accepted | yes |
| `wfm_hist_001_s18` | 2026-03-25 | 86.90 | accepted | yes |
| `wfm_hist_001_s19` | 2026-03-26 | 86.10 | accepted | yes |
| `wfm_hist_001_s20` | 2026-03-27 | 85.70 | accepted | yes |
| `wfm_hist_001_s21` | 2026-03-30 | 86.20 | accepted | yes |
| `wfm_hist_001_s22` | 2026-03-31 | 86.80 | accepted | yes |
| `wfm_hist_001_s23` | 2026-04-01 | 87.10 | accepted | yes |
| `wfm_hist_001_s24` | 2026-04-02 | 87.50 | accepted | yes |
| `wfm_hist_001_s25` | 2026-04-07 | 86.80 | accepted | yes |
| `wfm_hist_001_s26` | 2026-04-08 | 86.40 | accepted | yes |
| `wfm_hist_001_s27` | 2026-04-09 | 86.90 | accepted | yes |
| `wfm_hist_001_s28` | 2026-04-10 | 87.40 | accepted | yes |
| `wfm_hist_001_s29` | 2026-04-13 | 87.20 | accepted | yes |
| `wfm_hist_001_s30` | 2026-04-14 | 87.20 (carried forward from S29) | **pending** | **no** |

S30 is "today": still in session, `MarketSessionFinality` not accepted. Its
`outcomeEvidenceRevisionIds` is therefore **empty** and its `permittedPurposes`
contains only `character_interaction`. Its close-price revision is
`rightsScope: "interaction"` and declares
`carriedForwardFromFactRevisionId: "fact-hist-001-s29-price"`, so the reused number
is auditable rather than silently duplicated. That is the fail-closed shape the
rest of the product depends on: an un-finalised session withholds the whole
allowlist entry, it never publishes a nulled placeholder.

## Fact revision ids and the plot facts

Every id embeds the zero-padded session it originates in (`fact-hist-001-sNN-…`),
so ids are stable and their byte order is date order.

| `factRevisionId` | Origin | Kind | Role |
| --- | --- | --- | --- |
| `fact-hist-001-s01-momentum` | S1, pre-open | `market_momentum_signal` | The signal available at S1's open that the character does not attend to. |
| `fact-hist-001-s01-counter-inventory` | S1, intraday | `peer_group_inventory_days` | The counter-evidence, public from S1 and interaction-eligible in every later session; the audit asserts it never drops out of a later interaction allowlist. |
| `fact-hist-001-s07-correction` | S7 (2026-03-10), intraday | `issuer_correction_notice` | Supersedes `fact-hist-001-s01-momentum`: the earlier flow was a single institution rebalancing, not demand. |
| `fact-hist-001-s01-price`…`s30-price` | each session's close | `sealed_close_price` | The sealed closes above. |

Each fact revision names the manifest that first sealed it in `manifestId`; later
sessions reference the same id from their own allowlists without changing that
field, and the audit asserts each revision became available no later than its own
session's `evidenceCutoffAt`. Every revision becomes visible exactly once, in the
session that sealed it.

Interaction allowlists follow one rule: the counter-evidence from S2 on, the
correction from S8 on, and the two most recent sealed closes available before the
open (for S30, S29's accepted close plus its own carried-forward reference).

## Cutoffs in historical mode

`interactionCutoffAt` is that session's **open** (09:00:00+08:00) and
`evidenceCutoffAt` is its **close** (13:30:00+08:00). Eligibility arithmetic is
unchanged from `../v1`:

```text
available_at = max(worldPublishedAt, platformReceivedAt)

interaction eligibility:
  available_at <= min(character_world_time, interactionCutoffAt, CognitionInputSealed.occurred_at)

outcome/editorial evidence eligibility:
  available_at <= evidenceCutoffAt
```

One consequence is load-bearing and intentional: **a fact that first becomes
available intraday in session S is interaction-eligible only from session S+1's
manifest onwards.** Within session S it can only be outcome/post-close-editorial
evidence. That is why `fact-hist-001-s01-counter-inventory` (published intraday on
S1) appears in S1's *outcome* list and in the *interaction* list of S2 through S30,
and why `fact-hist-001-s07-correction` (published intraday on S7) is outcome
evidence for S7 and interaction-eligible only from S8. A character cannot react inside a
session to something that only surfaced mid-session; the fence is the contract, not
the narrative's convenience.

`rightsValidFrom` / `rightsValidUntil` remain an **ingest/bind gate only** and are
never used for eligibility, exactly as in `../v1`.

## The two-allowlist physical separation rule

Unchanged from [`../v1/README.md`](../v1/README.md): `interactionFactRevisionIds`
may only be used for exposure/attention/appraisal/action;
`outcomeEvidenceRevisionIds` may only be used for paper outcome, correction, and
post-close editorial. A revision cleared for both
(`rightsScope: "interaction_and_outcome"`) may appear in both lists, but each
pipeline resolves it through **its own** list's explicit ref. The audit checks the
rule from both directions, across all thirty manifests.

## Digest and canonicalization convention

Identical to `../v1` (RFC 8785 JCS, `sha256:<lowercase-hex>`) with one difference:

1. **`manifestHash`** — SHA-256 of the JCS canonical UTF-8 bytes of the manifest
   object with `manifestHash` and `objectHash` removed.
2. **`interactionFactSetDigest`** / **`outcomeEvidenceSetDigest`** — SHA-256 of the
   deduplicated, UTF-8-byte-sorted, `\n`-joined revision IDs of that list (no
   trailing newline), so the digest is a function of the *set*. An empty list
   digests the empty string — which is exactly what S30 carries.
3. **`objectHash`** — SHA-256 of the JCS canonical UTF-8 bytes of **this
   manifest's slice** of `synthetic-historical-001-fact-revisions.json`, i.e. the
   revisions whose `manifestId` equals this manifest's id, in file order. `../v1`
   hashes the whole sibling bundle because it mirrors one manifest per bundle; the
   thirty historical manifests share one fixture file, so each seals its own slice
   and `objectUri` carries `#<manifestId>` to name it.

`objectUri` uses the authority-less `panshi-fixture:` scheme with a
repository-relative opaque path. It structurally cannot contain a host, and the
audit asserts that: no real host, internal hostname, or private path may enter this
contract.
