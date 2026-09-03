#!/usr/bin/env ruby
# frozen_string_literal: true

# CI gate for docs/v5/contracts/canonical-owner-map.yaml.
#
# Proves the exact machine baseline asserted by docs/v5/pre-code-review.md and
# required by IMPLEMENTATION-HANDOFF.md's Definition of done #3: 14 bounded
# contexts (13 canonical-write), 38 canonical aggregates, 13 event families,
# 143 globally unique event names, 10 non-canonical projections with no
# command/canonical-event/write-back authority, and the Paper Account/Order/
# Position route split (4/4/6).

require "yaml"

ROOT = File.expand_path("..", __dir__)
MAP_PATH = File.join(ROOT, "docs/v5/contracts/canonical-owner-map.yaml")

EXPECTED_BOUNDED_CONTEXTS = 14
EXPECTED_CANONICAL_WRITE_CONTEXTS = 13
EXPECTED_AGGREGATES = 38
EXPECTED_EVENT_FAMILIES = 13
EXPECTED_EVENTS = 143
EXPECTED_PROJECTIONS = 10
EXPECTED_PAPER_ROUTES = { "PaperAccount" => 4, "PaperOrder" => 4, "PaperPosition" => 6 }.freeze

errors = []

map = YAML.safe_load(File.read(MAP_PATH), permitted_classes: [], aliases: false)

invariants = map.fetch("invariants", {})
%w[
  canonical_aggregate_has_exactly_one_owner_context
  canonical_event_name_has_exactly_one_owner_context
  event_name_is_globally_unique_across_event_families
  non_canonical_projection_may_not_accept_commands
  non_canonical_projection_may_not_emit_canonical_events
  non_canonical_projection_may_not_write_back_to_any_aggregate
].each do |key|
  errors << "invariants.#{key} must be declared true" unless invariants[key] == true
end

contexts = map.fetch("bounded_contexts", {})
errors << "expected #{EXPECTED_BOUNDED_CONTEXTS} bounded contexts, found #{contexts.size}" unless contexts.size == EXPECTED_BOUNDED_CONTEXTS

canonical_write_contexts = contexts.select { |_key, value| value["classification"] == "canonical_write_context" }
non_canonical_contexts = contexts.select { |_key, value| value["classification"] == "non_canonical_read_context" }
unless canonical_write_contexts.size == EXPECTED_CANONICAL_WRITE_CONTEXTS
  errors << "expected #{EXPECTED_CANONICAL_WRITE_CONTEXTS} canonical_write_context entries, found #{canonical_write_contexts.size}"
end
unless canonical_write_contexts.size + non_canonical_contexts.size == contexts.size
  errors << "every bounded context must be classified canonical_write_context or non_canonical_read_context"
end

aggregates = map.fetch("canonical_aggregates", {})
errors << "expected #{EXPECTED_AGGREGATES} canonical aggregates, found #{aggregates.size}" unless aggregates.size == EXPECTED_AGGREGATES

aggregates.each do |name, entry|
  owner = entry["owner_context"]
  errors << "aggregate #{name} has no owner_context" if owner.nil?
  errors << "aggregate #{name} owner_context #{owner} is not a canonical_write_context" if owner && !canonical_write_contexts.key?(owner)
end

families = map.fetch("canonical_event_families", {})
errors << "expected #{EXPECTED_EVENT_FAMILIES} event families, found #{families.size}" unless families.size == EXPECTED_EVENT_FAMILIES

families.each do |family_name, family|
  owner = family["owner_context"]
  errors << "event family #{family_name} has no owner_context" if owner.nil?
  errors << "event family #{family_name} owner_context #{owner} is not a canonical_write_context" if owner && !canonical_write_contexts.key?(owner)
end

all_events = families.flat_map { |_name, family| family.fetch("events", []) }
errors << "expected #{EXPECTED_EVENTS} canonical events, found #{all_events.size}" unless all_events.size == EXPECTED_EVENTS

duplicate_events = all_events.tally.select { |_event, count| count > 1 }.keys
errors << "event names must be globally unique across event families; duplicates: #{duplicate_events.join(', ')}" unless duplicate_events.empty?

# Every event name must belong to exactly one owner_context (redundant with
# global-uniqueness above, but stated as its own gate because it is a
# distinct invariant in the source doc).
event_owner = {}
families.each do |_family_name, family|
  owner = family.fetch("owner_context")
  family.fetch("events", []).each do |event_name|
    if event_owner.key?(event_name) && event_owner[event_name] != owner
      errors << "event #{event_name} has more than one owner_context: #{event_owner[event_name]} and #{owner}"
    end
    event_owner[event_name] = owner
  end
end

paper_family = families["paper_portfolio"]
if paper_family.nil?
  errors << "paper_portfolio event family is required for the Paper Account/Order/Position route audit"
else
  routes = paper_family.fetch("aggregate_event_routes", {})
  EXPECTED_PAPER_ROUTES.each do |aggregate, expected_count|
    actual_events = routes[aggregate]
    if actual_events.nil?
      errors << "paper_portfolio.aggregate_event_routes is missing #{aggregate}"
      next
    end
    unless actual_events.size == expected_count
      errors << "#{aggregate} expected #{expected_count} routed events, found #{actual_events.size}: #{actual_events.join(', ')}"
    end
    duplicate_route_events = actual_events.tally.select { |_event, count| count > 1 }.keys
    errors << "#{aggregate} routes list duplicate events: #{duplicate_route_events.join(', ')}" unless duplicate_route_events.empty?
  end

  # No event may be routed to more than one Paper aggregate, and no event may
  # be missing from the flat `events` list for the family.
  routed_events = routes.values.flatten
  routed_duplicates = routed_events.tally.select { |_event, count| count > 1 }.keys
  errors << "an event is routed to more than one Paper Portfolio aggregate: #{routed_duplicates.join(', ')}" unless routed_duplicates.empty?

  family_events = paper_family.fetch("events", [])
  missing_from_family = routed_events - family_events
  errors << "Paper Portfolio routed events missing from the family event list: #{missing_from_family.join(', ')}" unless missing_from_family.empty?
  missing_from_routes = family_events - routed_events
  errors << "Paper Portfolio family events missing a PaperAccount/PaperOrder/PaperPosition route: #{missing_from_routes.join(', ')}" unless missing_from_routes.empty?
end

projections = map.fetch("non_canonical_projections", {})
errors << "expected #{EXPECTED_PROJECTIONS} non-canonical projections, found #{projections.size}" unless projections.size == EXPECTED_PROJECTIONS

projections.each do |name, entry|
  errors << "projection #{name} must declare canonical: false" unless entry["canonical"] == false
  errors << "projection #{name} must declare may_accept_commands: false" unless entry["may_accept_commands"] == false
  errors << "projection #{name} must declare may_write_back: false" unless entry["may_write_back"] == false
  errors << "projection #{name} must not declare authoritative_aggregates with entries" if entry["authoritative_aggregates"].is_a?(Array) && !entry["authoritative_aggregates"].empty?
  errors << "projection #{name} owner_context must be a declared bounded context" unless contexts.key?(entry["owner_context"])
end

# Projections must never reuse a canonical event name and must never appear
# as an aggregate owner.
projection_names = projections.keys
overlap_with_events = projection_names & all_events
errors << "projection names collide with canonical event names: #{overlap_with_events.join(', ')}" unless overlap_with_events.empty?
overlap_with_aggregates = projection_names & aggregates.keys
errors << "projection names collide with canonical aggregate names: #{overlap_with_aggregates.join(', ')}" unless overlap_with_aggregates.empty?

gaps = map.fetch("documentation_gaps", [])
errors << "documentation_gaps must be an array" unless gaps.is_a?(Array)

unless errors.empty?
  warn errors.join("\n")
  exit 1
end

puts "owner-map audit passed: #{contexts.size} bounded contexts (#{canonical_write_contexts.size} canonical-write), " \
     "#{aggregates.size} aggregates, #{families.size} event families, #{all_events.size} globally-unique events, " \
     "#{projections.size} non-canonical projections, Paper routes #{EXPECTED_PAPER_ROUTES}"
