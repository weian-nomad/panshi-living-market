# Sealed fact v1

This is the only market-data boundary V4 freezes before the 24-person study. It keeps observed market evidence portable without deciding the later simulation architecture.

Route: `GET /sealed-facts/v1/{fact_id}` on the future world API boundary.

Rules:

- A `fact_id` is immutable. Corrections append a new fact with `supersedes`; they never update or delete the prior fact.
- `content_hash` is the lowercase SHA-256 of the UTF-8 bytes of the [RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785) representation of the complete object excluding `content_hash`.
- `market_date_taipei` always means the `Asia/Taipei` market calendar day, not the caller's locale.
- `source` is a public source name or a stable product alias. It never stores a credential, secret endpoint or non-public provider name.
- `payload` contains observed source values only. It must not contain character state, dialogue, narrative, symbolic interpretation, astrology, win-rate claims, forecasts, price targets, rankings, buy/sell language or trading instructions.
- Character and world services may reference `fact_id`; they may not mutate the sealed fact or write their interpretation back into this contract.

`test-vector.json` is the cross-language conformance vector. An implementation must reproduce both its `canonical_jcs_utf8` bytes and `content_hash` before it can emit or consume this contract.

No endpoint is implemented during device-only research. The contract exists now only to prevent future origin and data-boundary migration from changing the evidence model.
