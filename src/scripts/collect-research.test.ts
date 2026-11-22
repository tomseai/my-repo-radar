import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";

import {
  parseCollectorArgs,
  safeCachedPath,
  safeGitArguments,
  scoreResearchPath,
  selectResearchPaths,
} from "./collect-research.js";

test("parseCollectorArgs accepts collection limits and a repository filter", () => {
  const options = parseCollectorArgs([
    "--repo",
    "adonisjs/core",
    "--concurrency",
    "5",
    "--limit",
    "10",
    "--max-files",
    "30",
    "--force",
  ]);
  assert.equal(options.repository, "adonisjs/core");
  assert.equal(options.concurrency, 5);
  assert.equal(options.limit, 10);
  assert.equal(options.maxFiles, 30);
  assert.equal(options.force, true);
});

test("parseCollectorArgs rejects malformed repository names", () => {
  assert.throws(() => parseCollectorArgs(["--repo", "adonisjs"]), /owner\/name/);
});

test("scoreResearchPath prioritizes root documentation and manifests", () => {
  assert.ok((scoreResearchPath("README.md") ?? 0) > (scoreResearchPath("docs/overview.md") ?? 0));
  assert.ok((scoreResearchPath("package.json") ?? 0) > (scoreResearchPath("docs/misc.md") ?? 0));
  assert.equal(scoreResearchPath("assets/logo.png"), null);
});

test("selectResearchPaths is deterministic and respects the maximum", () => {
  const selected = selectResearchPaths([
    "docs/usage.md",
    "package.json",
    "README.md",
    "docs/architecture.md",
    "assets/logo.png",
  ], 3);
  assert.deepEqual(selected.map((item) => item.path), ["README.md", "package.json", "docs/architecture.md"]);
});

test("safeCachedPath replaces Windows-reserved characters and rejects traversal", () => {
  assert.equal(safeCachedPath("docs/setup?.md"), "docs/setup_.md");
  assert.throws(() => safeCachedPath("../secret.txt"), /Unsafe repository path/);
});

test("safeGitArguments scopes Git ownership trust to the active clone", () => {
  const clone = resolve("cache", "example");
  assert.deepEqual(safeGitArguments(["fetch", "origin", "main"], clone), [
    "-c",
    `safe.directory=${clone}`,
    "fetch",
    "origin",
    "main",
  ]);
  assert.deepEqual(safeGitArguments(["clone", "https://example.com/repo.git"]), [
    "clone",
    "https://example.com/repo.git",
  ]);
});
