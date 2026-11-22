import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertCompatible,
  emptyState,
  facets,
  filterKeys,
  filterValues,
  label,
  parseHash,
  primaryTopic,
  selectRepositories,
  toHash,
  type CatalogArtifact,
  type SearchArtifact,
} from "../web-model.js";

const catalog = JSON.parse(
  await readFile(
    new URL("../../generated/catalog.json", import.meta.url),
    "utf8",
  ),
) as CatalogArtifact;
const search = JSON.parse(
  await readFile(
    new URL("../../generated/search-index.json", import.meta.url),
    "utf8",
  ),
) as SearchArtifact;

test("URL state round-trips filters, detail, focused repo and comparisons", () => {
  const state = {
    ...emptyState,
    q: "memory & MCP",
    topic: "agent-memory",
    category: "ai-and-automation",
    repo: catalog.repositories[0]!.id,
    focus: catalog.repositories[1]!.id,
    compare: catalog.repositories.slice(0, 3).map((repo) => repo.id),
    sort: "reviewed",
  };
  assert.deepEqual(parseHash(toHash(state)), state);
  assert.deepEqual(parseHash("#/"), emptyState);
  assert.equal(parseHash("#/?sort=invalid").sort, "name");
  assert.deepEqual(parseHash("#/?compare=a,a,b,c,d,e,f").compare, [
    "a",
    "b",
    "c",
    "d",
    "e",
  ]);
});
test("catalog and search artifacts must share a version and exact identities", () => {
  assert.doesNotThrow(() => assertCompatible(catalog, search));
  assert.throws(
    () =>
      assertCompatible(catalog, {
        ...search,
        entries: search.entries.slice(1),
      }),
    /match/,
  );
  assert.throws(
    () =>
      assertCompatible(catalog, {
        ...search,
        entries: search.entries.map((entry, i) =>
          i ? entry : { ...entry, id: "missing" },
        ),
      }),
    /match/,
  );
  assert.throws(
    () =>
      assertCompatible(catalog, {
        ...search,
        schema_version: 2,
      } as unknown as SearchArtifact),
    /format/,
  );
});
test("default listing includes each repo once and does not mutate canonical ordering", () => {
  const original = catalog.repositories.map((repo) => repo.id);
  const result = selectRepositories(catalog.repositories, search, emptyState);
  assert.equal(result.length, catalog.counts.repositories);
  assert.equal(new Set(result.map((repo) => repo.id)).size, result.length);
  assert.deepEqual(
    catalog.repositories.map((repo) => repo.id),
    original,
  );
});
test("every supported filter returns exactly its facet membership", () => {
  for (const key of filterKeys)
    for (const [value, count] of facets(catalog.repositories, key)) {
      const selected = selectRepositories(catalog.repositories, search, {
        ...emptyState,
        [key]: value,
      });
      assert.equal(selected.length, count, `${key}=${value}`);
      assert.ok(
        selected.every((repo) => filterValues(repo, key).includes(value)),
      );
    }
});
test("topics include secondary topics, not only the first listed topic", () => {
  const repo = catalog.repositories.find(
    (repo) => repo.classification.topics.length > 1,
  )!;
  const topic = repo.classification.topics[1]!;
  assert.notEqual(primaryTopic(repo), topic);
  assert.ok(
    selectRepositories(catalog.repositories, search, {
      ...emptyState,
      topic,
    }).some((item) => item.id === repo.id),
  );
});
test("search is case-insensitive and ANDs terms and filters", () => {
  const terms = "AGENT MEMORY";
  const result = selectRepositories(catalog.repositories, search, {
    ...emptyState,
    q: terms,
    topic: "agent-memory",
  });
  assert.ok(result.length > 0);
  for (const repo of result) {
    const entry = search.entries.find((entry) => entry.id === repo.id)!;
    assert.ok(entry.text.includes("agent") && entry.text.includes("memory"));
    assert.ok(repo.classification.topics.includes("agent-memory"));
  }
  assert.equal(
    selectRepositories(catalog.repositories, search, {
      ...emptyState,
      q: "no-match-928571xyz",
    }).length,
    0,
  );
});
test("aliases remain searchable after repository transfers", () => {
  const repo = catalog.repositories.find(
    (repo) => repo.identity.aliases.length,
  )!;
  assert.ok(
    selectRepositories(catalog.repositories, search, {
      ...emptyState,
      q: repo.identity.aliases[0]!,
    }).some((item) => item.id === repo.id),
  );
});
test("stars and snapshot dates sort descending without changing underlying data", () => {
  for (const [sort, get] of [
    [
      "stars",
      (repo: (typeof catalog.repositories)[number]) => repo.github.stars,
    ],
    [
      "reviewed",
      (repo: (typeof catalog.repositories)[number]) =>
        repo.research.researched_at
          ? Date.parse(repo.research.researched_at)
          : 0,
    ],
    [
      "updated",
      (repo: (typeof catalog.repositories)[number]) =>
        repo.github.pushed_at ? Date.parse(repo.github.pushed_at) : 0,
    ],
  ] as const) {
    const result = selectRepositories(catalog.repositories, search, {
      ...emptyState,
      sort,
    });
    for (let i = 1; i < result.length; i++)
      assert.ok(get(result[i - 1]!) >= get(result[i]!));
  }
});
test("relevance favors name matches over long-text-only matches", () => {
  const first = structuredClone(catalog.repositories[0]!);
  const second = structuredClone(first);
  first.id = "first";
  first.project.name = "Needle";
  first.project.summary = "Something";
  second.id = "second";
  second.project.name = "Aardvark";
  second.project.summary = "Something";
  const entries = [first, second].map((repo) => ({
    ...search.entries[0]!,
    id: repo.id,
    text: "needle",
  }));
  assert.equal(
    selectRepositories(
      [second, first],
      { ...search, entries },
      { ...emptyState, q: "needle", sort: "relevance" },
    )[0]!.id,
    "first",
  );
});
test("review sorting handles fractional seconds, offsets and unknown dates", () => {
  const repos = [
    ["whole", "2026-07-20T09:00:00Z"],
    ["fraction", "2026-07-20T09:00:00.900Z"],
    ["offset", "2026-07-20T10:00:00+02:00"],
    ["unknown", null],
  ].map(([id, reviewed]) => {
    const repo = structuredClone(catalog.repositories[0]!);
    repo.id = id!;
    repo.research.researched_at = reviewed!;
    return repo;
  });
  assert.deepEqual(
    selectRepositories(repos, search, { ...emptyState, sort: "reviewed" }).map(
      (repo) => repo.id,
    ),
    ["fraction", "whole", "offset", "unknown"],
  );
});
test("unknown license is not reclassified as permissive", () => {
  const repo = structuredClone(catalog.repositories[0]!);
  repo.license.spdx = null;
  repo.license.name = "Mixed licenses";
  assert.deepEqual(filterValues(repo, "license"), ["unknown"]);
  assert.equal(label("ai-and-automation"), "AI and Automation");
});
