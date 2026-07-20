#!/usr/bin/env ruby
# frozen_string_literal: true

require "digest"
require "json"

ROOT = File.expand_path("..", __dir__)
fixture_dir = File.join(ROOT, "fixtures/historical/episode-001")
manifest = JSON.parse(File.read(File.join(fixture_dir, "manifest.json")))
input_path = File.join(fixture_dir, "decision-input.json")
actions_path = File.join(fixture_dir, "expected-actions.json")
input_protobuf_path = File.join(fixture_dir, "input.pb")
output_protobuf_path = File.join(fixture_dir, "output.pb")
input = JSON.parse(File.read(input_path))
actions = JSON.parse(File.read(actions_path))

errors = []
errors << "fixture must be sealed" unless manifest.fetch("sealed")
errors << "fixture must remain historical" unless input.fetch("mode") == "historical"
errors << "fixture must be fictional" unless input.fetch("truthClass") == "fictional_setting"
errors << "fixture must contain five seats" unless input.fetch("seats").length == 5
errors << "fixture must contain five actions" unless actions.fetch("actions").length == 5
errors << "seat order is not canonical" unless input.fetch("seats").map { |seat| seat.fetch("seatIndex") } == (0..4).to_a
errors << "action order is not canonical" unless actions.fetch("actions").map(&:first) == (0..4).to_a

input.fetch("seats").each do |seat|
  errors << "seat #{seat.fetch('seatIndex')} must contain four companies" unless seat.fetch("companies").length == 4
end

{
  "decisionInputSha256" => input_path,
  "expectedActionsSha256" => actions_path,
  "canonicalInputProtobufSha256" => input_protobuf_path,
  "canonicalOutputProtobufSha256" => output_protobuf_path
}.each do |field, path|
  actual = Digest::SHA256.file(path).hexdigest
  expected = manifest.fetch(field)
  errors << "#{field} mismatch: expected #{expected}, got #{actual}" unless actual == expected
end

unless errors.empty?
  warn errors.join("\n")
  exit 1
end

puts "fixture audit passed: historical-episode-001 JSON and Protobuf are sealed and canonical"
