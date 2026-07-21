import assert from "node:assert/strict";
import test from "node:test";

import { parsePrefillArgs, selectDossierSources } from "./prefill-dossiers.js";

test("parsePrefillArgs supports pilot and repeated repositories", () => {
  const options = parsePrefillArgs(["--pilot", "--repo", "adonisjs/core", "--repo", "oraios/serena"]);
  assert.equal(options.pilot, true);
  assert.deepEqual(options.repositories, ["adonisjs/core", "oraios/serena"]);
});

test("parsePrefillArgs requires an explicit selection", () => {
  assert.throws(() => parsePrefillArgs([]), /Choose --pilot/);
});

test("selectDossierSources prioritizes README, license, security, and package manifest", () => {
  const sources = selectDossierSources({
    collected_at: "2026-07-19T00:00:00Z",
    full_name: "example/project",
    source_commit: "a".repeat(40),
    files: [
      { cached_path: "files/docs/usage.md", path: "docs/usage.md", source_url: "https://example.com/usage" },
      { cached_path: "files/package.json", path: "package.json", source_url: "https://example.com/package" },
      { cached_path: "files/SECURITY.md", path: "SECURITY.md", source_url: "https://example.com/security" },
      { cached_path: "files/LICENSE", path: "LICENSE", source_url: "https://example.com/license" },
      { cached_path: "files/README.md", path: "README.md", source_url: "https://example.com/readme" },
    ],
  });
  assert.deepEqual(sources.slice(0, 4).map((source) => source.path), ["README.md", "LICENSE", "SECURITY.md", "package.json"]);
  assert.equal(new Set(sources.map((source) => source.id)).size, sources.length);
});
