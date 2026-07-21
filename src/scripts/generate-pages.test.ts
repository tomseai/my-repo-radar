import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogArtifact, CatalogRepository } from "./generate-catalog.js";
import { buildMarkdownPages, displayName } from "./generate-pages.js";

const repository = {
  id: "github:example/tool",
  identity: { aliases: [], name: "tool", owner: "example", url: "https://github.com/example/tool" },
  project: { best_for: ["Developers"], kind: "cli", name: "Tool", summary: "A useful command-line tool." },
  classification: { primary_category: "developer-tools", technologies: ["typescript"], topics: ["cli", "testing"], use_cases: [] },
  key_features: ["Fast", "Small", "Portable"],
  usage: { installation: ["npm"], interfaces: ["CLI"], setup: "low" },
  technology: { languages: ["TypeScript"], notable_components: ["Node.js"] },
  license: { name: "MIT License", notes: null, spdx: "MIT" },
  status: { archived: false, latest_release: null, latest_release_at: null, lifecycle: "active" },
  github: {
    archived: false, created_at: null, default_branch: "main", description: null, disabled: false,
    fetched_at: "2026-07-20T00:00:00Z", fork: false, forks: 1, homepage: null,
    latest_release: null, license_spdx: "MIT", open_issues: 0, primary_language: "TypeScript",
    pushed_at: null, stars: 10, topics: [], updated_at: null,
  },
  research: { bundle_collected_at: "2026-07-19T00:00:00Z", confidence: "high", researched_at: "2026-07-20T00:00:00Z", source_commit: "a".repeat(40), state: "complete" },
  strengths: ["Focused"], caveats: ["Requires Node.js"], sources: ["https://example.com"],
} satisfies CatalogRepository;

const catalog: CatalogArtifact = {
  schema_version: 1,
  source_versions: { dossier: 2, inventory: 1, taxonomy: 1 },
  counts: { repositories: 1, research_states: { complete: 1 }, confidence: { high: 1 } },
  repositories: [repository],
};

test("displayName preserves common technical acronyms", () => {
  assert.equal(displayName("ai-and-automation"), "AI and Automation");
  assert.equal(displayName("devops-and-cloud"), "DevOps and Cloud");
});

test("buildMarkdownPages creates the root, category, and used topic pages", () => {
  const pages = buildMarkdownPages(catalog, {
    primary_categories: ["developer-tools", "other"],
    topics: ["cli", "testing", "unused"],
  });
  assert.deepEqual(pages.map((page) => page.path), [
    "README.md",
    "categories/developer-tools.md",
    "topics/cli.md",
    "topics/testing.md",
  ]);
  assert.match(pages[0].content, /Repositories by primary category/);
  assert.doesNotMatch(pages[0].content, /Browse by topic/);
  assert.match(pages[0].content, /topics\/cli\.md/);
  assert.match(pages[1].content, /\*\*Key features\*\*/);
  assert.match(pages[2].content, /Primary categories represented/);
});
