BEGIN;

-- V5 generalizes ModeDomain (docs/v5/system-design.md §18.1: "generalized
-- `ModeDomain`, V2 envelope, world session及 multi-stream story events").
-- This widens, but does not remove, the existing HISTORICAL-only gate: every
-- row written by the legacy-v2 five-seat path keeps its exact prior
-- constraint semantics (mode_domain = 'HISTORICAL' remains legal), and V5
-- canonical events additionally may write mode_domain = 'CURRENT'. No
-- existing row's mode_domain value changes.
ALTER TABLE event_store.events
  DROP CONSTRAINT events_mode_domain_check;

ALTER TABLE event_store.events
  ADD CONSTRAINT events_mode_domain_check
  CHECK (mode_domain IN ('HISTORICAL', 'CURRENT'));

COMMIT;
