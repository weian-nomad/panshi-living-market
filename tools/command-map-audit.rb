#!/usr/bin/env ruby
# frozen_string_literal: true

# CI gate for docs/v5/contracts/command-transition-map.yaml.
#
# Proves the separate command owner/transition audit required by
# IMPLEMENTATION-HANDOFF.md item 2 and Definition of done #4: every V5 command
# has one owner (a canonical_write_context), legal source states, one
# idempotency scope, a valid target aggregate and declared emitted canonical
# events; command names are globally unique; and every one of the 143 canonical
# events in docs/v5/contracts/canonical-owner-map.yaml is emitted by at least
# one command. canonical-owner-map.yaml remains authoritative for
# aggregate/event ownership; this audit does not duplicate that source of truth,
# it cross-checks the command layer against it.

require "yaml"
require "set"

ROOT = File.expand_path("..", __dir__)
COMMAND_MAP_PATH = File.join(ROOT, "docs/v5/contracts/command-transition-map.yaml")
OWNER_MAP_PATH = File.join(ROOT, "docs/v5/contracts/canonical-owner-map.yaml")

EXPECTED_EVENTS = 143
REQUIRED_KEYS = %w[command owner_context legal_source_states target_aggregate idempotency_scope emits].freeze

def blank?(value)
  case value
  when nil then true
  when String then value.strip.empty?
  when Array then value.empty? || value.all? { |item| blank?(item) }
  else false
  end
end

errors = []

command_map = YAML.safe_load(File.read(COMMAND_MAP_PATH), permitted_classes: [], aliases: false)
owner_map = YAML.safe_load(File.read(OWNER_MAP_PATH), permitted_classes: [], aliases: false)

commands = command_map.fetch("commands", [])
errors << "command-transition-map.yaml has no commands list" if commands.empty?

# Owner-map facts this audit cross-checks against.
contexts = owner_map.fetch("bounded_contexts", {})
canonical_write_contexts = contexts.select { |_key, value| value["classification"] == "canonical_write_context" }
aggregates = owner_map.fetch("canonical_aggregates", {})
families = owner_map.fetch("canonical_event_families", {})
canonical_events = families.flat_map { |_name, family| family.fetch("events", []) }.uniq

unless canonical_events.size == EXPECTED_EVENTS
  errors << "owner map exposes #{canonical_events.size} canonical events, expected #{EXPECTED_EVENTS}; audit baseline is stale"
end
canonical_event_set = canonical_events.to_set

# 1. Required keys present and non-empty on every command.
commands.each do |entry|
  name = entry.is_a?(Hash) ? (entry["command"] || "<unnamed>") : "<non-mapping entry>"
  unless entry.is_a?(Hash)
    errors << "command entry is not a mapping: #{entry.inspect}"
    next
  end
  REQUIRED_KEYS.each do |key|
    errors << "#{name} is missing required key '#{key}'" unless entry.key?(key)
    errors << "#{name} has empty required key '#{key}'" if entry.key?(key) && blank?(entry[key])
  end
end

# 2. Command names globally unique.
command_names = commands.map { |entry| entry.is_a?(Hash) ? entry["command"] : nil }.compact
duplicate_commands = command_names.tally.select { |_name, count| count > 1 }.keys
errors << "duplicate command names: #{duplicate_commands.join(', ')}" unless duplicate_commands.empty?

# 3. owner_context must be a declared canonical_write_context.
commands.each do |entry|
  next unless entry.is_a?(Hash)

  owner = entry["owner_context"]
  next if blank?(owner)

  if !contexts.key?(owner)
    errors << "#{entry['command']} owner_context '#{owner}' is not a declared bounded context"
  elsif !canonical_write_contexts.key?(owner)
    errors << "#{entry['command']} owner_context '#{owner}' is not a canonical_write_context"
  end
end

# 4. target_aggregate (string or array) must be a declared canonical aggregate.
commands.each do |entry|
  next unless entry.is_a?(Hash)

  targets = Array(entry["target_aggregate"])
  targets.each do |target|
    next if blank?(target)

    errors << "#{entry['command']} target_aggregate '#{target}' is not a declared canonical aggregate" unless aggregates.key?(target)
  end
end

# 5. Every emitted event must be a real canonical event name.
commands.each do |entry|
  next unless entry.is_a?(Hash)

  Array(entry["emits"]).each do |event_name|
    next if blank?(event_name)

    errors << "#{entry['command']} emits unknown canonical event '#{event_name}'" unless canonical_event_set.include?(event_name)
  end
end

# 6. Completeness: every canonical event is emitted by at least one command.
emitted_events = commands.flat_map { |entry| entry.is_a?(Hash) ? Array(entry["emits"]) : [] }.uniq
covered_events = canonical_events & emitted_events
uncovered_events = canonical_events - emitted_events
unless uncovered_events.empty?
  errors << "canonical events not covered by any command emits (#{uncovered_events.size}): #{uncovered_events.join(', ')}"
end

unless errors.empty?
  warn errors.join("\n")
  exit 1
end

puts "command-map audit passed: #{command_names.size} commands, " \
     "#{covered_events.size}/#{EXPECTED_EVENTS} canonical events covered"
