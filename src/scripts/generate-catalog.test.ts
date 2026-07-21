import assert from "node:assert/strict";
import test from "node:test";

import { buildArtifacts } from "./generate-catalog.js";

function fixture(id: string, stars: number) {
  const [owner, name] = id.slice("github:".length).split("/");
  return {
    inventory: {
      version: 1,
      id,
      repository: { aliases: [], owner, name, url: `https://github.com/${owner}/${name}` },
      import: {
        github_snapshot: {
          archived: false, created_at: null, default_branch: "main", description: "Useful tool", disabled: false,
          fetched_at: "2026-07-20T00:00:00Z", fork: false, forks: 2, homepage: null,
          license_spdx: "MIT", latest_release: null, open_issues: 1, primary_language: "TypeScript",
          pushed_at: null, stars, topics: ["tool"], updated_at: null,
        },
      },
      analysis: { classification: { primary_category: "developer-tools", technologies: ["typescript"], topics: [], use_cases: ["developer-productivity"] } },
    },
    dossier: {
      schema_version: 2,
      repository_id: id,
      research: { bundle_collected_at: "2026-07-19T00:00:00Z", confidence: "high", researched_at: "2026-07-20T00:00:00Z", source_commit: "a".repeat(40), state: "complete" },
      classification: { primary_category: "developer-tools", topics: ["cli"] },
      project: { best_for: ["Developers"], kind: "cli", name, summary: "A useful developer tool." },
      key_features: ["Fast search"],
      usage: { installation: ["npm"], interfaces: ["CLI"], setup: "low" },
      technology: { languages: ["TypeScript"], notable_components: ["Node.js"] },
      license: { name: "MIT License", notes: null, spdx: "MIT" },
      status: { archived: false, latest_release: null, latest_release_at: null, lifecycle: "active" },
      strengths: ["Focused"], caveats: ["Requires Node.js"], sources: ["https://example.com"],
    },
  };
}

test("buildArtifacts sorts repositories and records aggregate counts", () => {
  const artifacts = buildArtifacts([
    fixture("github:zeta/tool", 2),
    fixture("github:alpha/tool", 4),
  ], 1);
  assert.deepEqual(artifacts.catalog.repositories.map((entry) => entry.id), ["github:alpha/tool", "github:zeta/tool"]);
  assert.deepEqual(artifacts.catalog.counts, {
    repositories: 2,
    research_states: { complete: 2 },
    confidence: { high: 2 },
  });
  assert.equal(artifacts.search.count, 2);
});

test("search entries expose filter fields and normalized searchable text", () => {
  const { search } = buildArtifacts([fixture("github:Example/Tool", 42)], 1);
  const entry = search.entries[0];
  assert.equal(entry.stars, 42);
  assert.deepEqual(entry.topics, ["cli"]);
  assert.match(entry.text, /example tool/);
  assert.match(entry.text, /fast search/);
  assert.equal(entry.text, entry.text.toLowerCase());
});

test("buildArtifacts rejects mismatched inventory and dossier identities", () => {
  const record = fixture("github:alpha/tool", 1);
  record.dossier.repository_id = "github:other/tool";
  assert.throws(() => buildArtifacts([record], 1), /is paired with dossier/);
});
