#!/usr/bin/env ruby
# frozen_string_literal: true

require "yaml"

ROOT = File.expand_path("..", __dir__)
CATALOG_PATH = File.join(ROOT, "docs/architecture/event-catalog.md")
PAYLOAD_PATH = File.join(ROOT, "docs/architecture/state-payload-map.md")
MATRIX_PATH = File.join(ROOT, "contracts/policy/command-transition-map.yaml")

def fenced_identifiers_between(text, start_heading, end_heading)
  section = text.split(start_heading, 2).fetch(1).split(end_heading, 2).first
  section.scan(/^([A-Z][A-Za-z0-9]+)$/).flatten
end

catalog = File.read(CATALOG_PATH)
payload_map = File.read(PAYLOAD_PATH)
matrix = YAML.safe_load(File.read(MATRIX_PATH), permitted_classes: [], aliases: false)

required_commands = fenced_identifiers_between(catalog, "## Required commands", "## Required events")
required_events = fenced_identifiers_between(catalog, "## Required events", "## Scheduler contract")
commands = matrix.fetch("commands")
matrix_commands = commands.map { |entry| entry.fetch("command") }
matrix_events = commands.flat_map { |entry| entry.fetch("emits") }.uniq
payload_events = payload_map.scan(/^\| `([A-Z][A-Za-z0-9]+)` \|/).flatten.uniq

errors = []
errors << "duplicate commands in catalog: #{required_commands.tally.select { |_key, count| count > 1 }.keys.join(', ')}" unless required_commands.uniq.length == required_commands.length
errors << "duplicate commands in matrix: #{matrix_commands.tally.select { |_key, count| count > 1 }.keys.join(', ')}" unless matrix_commands.uniq.length == matrix_commands.length
errors << "catalog commands absent from matrix: #{(required_commands - matrix_commands).join(', ')}" unless (required_commands - matrix_commands).empty?
errors << "matrix commands absent from catalog: #{(matrix_commands - required_commands).join(', ')}" unless (matrix_commands - required_commands).empty?
errors << "catalog events absent from matrix: #{(required_events - matrix_events).join(', ')}" unless (required_events - matrix_events).empty?
errors << "matrix events absent from catalog: #{(matrix_events - required_events).join(', ')}" unless (matrix_events - required_events).empty?
errors << "catalog events absent from payload map: #{(required_events - payload_events).join(', ')}" unless (required_events - payload_events).empty?

commands.each do |entry|
  %w[command owner primary_target from to emits].each do |key|
    errors << "#{entry['command'] || '<unknown>'} missing #{key}" unless entry.key?(key)
  end
end

unless errors.empty?
  warn errors.join("\n")
  exit 1
end

puts "contract audit passed: #{required_commands.length} commands, #{required_events.length} canonical events"
