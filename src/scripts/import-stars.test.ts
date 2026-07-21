import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeImportDocument,
  collectStarredRepositories,
  parseCliArgs,
  parseLinkHeader,
  repositoryFilename,
  serializeRepositoryRecord,
} from "./import-stars.js";

test("parseCliArgs accepts explicit importer options", () => {
  const options = parseCliArgs([
    "--user",
    "octocat",
    "--output-dir",
    "tmp/records",
    "--per-page",
    "50",
    "--max-retries",
    "2",
    "--retry-base-delay-ms",
    "200",
  ]);

  assert.equal(options.username, "octocat");
  assert.equal(options.outputDirectory, "tmp/records");
  assert.equal(options.perPage, 50);
  assert.equal(options.maxRetries, 2);
  assert.equal(options.retryBaseDelayMs, 200);
});

test("parseCliArgs rejects an invalid page size", () => {
  assert.throws(() => parseCliArgs(["--per-page", "101"]), /between 1 and 100/);
});

test("parseLinkHeader returns the next URL", () => {
  const links = parseLinkHeader(
    '<https://api.github.com/users/octocat/starred?page=2>; rel="next", <https://api.github.com/users/octocat/starred?page=3>; rel="last"',
  );

  assert.equal(links.get("next"), "https://api.github.com/users/octocat/starred?page=2");
  assert.equal(links.get("last"), "https://api.github.com/users/octocat/starred?page=3");
});

test("normalizeImportDocument sorts repositories and keeps starred_at", () => {
  const document = normalizeImportDocument("octocat", "https://api.github.com", [
    { repository: { id: 2, full_name: "zeta/tool", topic: ["b", "a"] }, starred_at: null },
    { repository: { id: 1, full_name: "alpha/tool" }, starred_at: "2026-07-19T00:00:00Z" },
  ]);

  assert.deepEqual(
    document.repositories.map((record) => record.repository.full_name),
    ["alpha/tool", "zeta/tool"],
  );
  assert.equal(document.repositories[0].starred_at, "2026-07-19T00:00:00Z");
  assert.equal(repositoryFilename(document.repositories[0]), "alpha--tool.yaml");
  assert.equal(repositoryFilename(document.repositories[1]), "zeta--tool.yaml");
});

test("serializeRepositoryRecord creates the initial YAML shape deterministically", () => {
  const record = {
    repository: {
      archived: false,
      created_at: "2026-07-01T00:00:00Z",
      default_branch: "main",
      description: "A tool",
      disabled: false,
      fork: false,
      forks_count: 2,
      full_name: "Alpha/Tool",
      homepage: null,
      html_url: "https://github.com/Alpha/Tool",
      id: 1,
      language: "TypeScript",
      node_id: "R_kgDOexample",
      open_issues_count: 0,
      pushed_at: "2026-07-19T00:00:00Z",
      stargazers_count: 4,
      topics: ["tool", "typescript"],
      updated_at: "2026-07-19T00:00:00Z",
    },
    starred_at: "2026-07-19T00:00:00Z",
  };
  const yaml = serializeRepositoryRecord(record, "octocat", "2026-07-19T12:00:00Z");

  assert.match(yaml, /^analysis:\n  analyzed_at: null/);
  assert.match(yaml, /id: "github:Alpha\/Tool"/);
  assert.match(yaml, /github_snapshot:/);
  assert.match(yaml, /observed_at: "2026-07-19T00:00:00Z"/);
  assert.match(yaml, /fetched_at: "2026-07-19T12:00:00Z"/);
  assert.match(yaml, /repository:\n(?:  .*\n)*  name: "Tool"\n  owner: "Alpha"\n  url: "https:\/\/github.com\/Alpha\/Tool"/);
});

test("collectStarredRepositories follows pagination and preserves starred_at", async () => {
  const options = parseCliArgs(["--user", "octocat", "--fetched-at", "2026-07-19T12:00:00Z"]);
  const firstPage = "https://api.github.com/users/octocat/starred?per_page=100";
  const secondPage = "https://api.github.com/users/octocat/starred?page=2";
  const responses = new Map([
    [firstPage, {
      body: [{ repo: { id: 2, full_name: "zeta/tool" }, starred_at: "2026-07-19T00:00:00Z" }],
      link: `<${secondPage}>; rel="next"`,
    }],
    [secondPage, {
      body: [{ repo: { id: 1, full_name: "alpha/tool" }, starred_at: "2026-07-18T00:00:00Z" }],
      link: null,
    }],
  ]);

  const document = await collectStarredRepositories(options, async (url) => {
    const response = responses.get(url);
    assert.ok(response, `Unexpected request: ${url}`);
    return {
      headers: new Headers(response.link ? { link: response.link } : {}),
      json: async () => response.body,
      ok: true,
      status: 200,
      statusText: "OK",
    };
  });

  assert.deepEqual(
    document.repositories.map((record) => [record.repository.full_name, record.starred_at]),
    [["alpha/tool", "2026-07-18T00:00:00Z"], ["zeta/tool", "2026-07-19T00:00:00Z"]],
  );
});

test("normalizeImportDocument rejects duplicate repositories", () => {
  assert.throws(
    () =>
      normalizeImportDocument("octocat", "https://api.github.com", [
        { repository: { id: 1, full_name: "alpha/tool" }, starred_at: null },
        { repository: { id: 1, full_name: "beta/tool" }, starred_at: null },
      ]),
    /duplicate starred repository/,
  );
});
