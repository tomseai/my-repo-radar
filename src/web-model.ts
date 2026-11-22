import type {
  CatalogArtifact,
  CatalogRepository,
  SearchArtifact,
} from "./scripts/generate-catalog.js";

export type { CatalogArtifact, CatalogRepository, SearchArtifact };
export const filterKeys = [
  "category",
  "topic",
  "language",
  "technology",
  "license",
  "kind",
  "lifecycle",
  "archived",
  "state",
] as const;
export type FilterKey = (typeof filterKeys)[number];
export type ViewState = Record<FilterKey, string> & {
  q: string;
  sort: string;
  repo: string;
  view: string;
  focus: string;
  compare: string[];
};
export const emptyState: ViewState = {
  q: "",
  category: "",
  topic: "",
  language: "",
  technology: "",
  license: "",
  kind: "",
  lifecycle: "",
  archived: "",
  state: "",
  sort: "name",
  repo: "",
  view: "",
  focus: "",
  compare: [],
};
export function parseHash(hash: string): ViewState {
  const query = new URLSearchParams(hash.split("?")[1] ?? "");
  const state = { ...emptyState };
  for (const key of [
    ...filterKeys,
    "q",
    "sort",
    "repo",
    "view",
    "focus",
  ] as const) {
    state[key] = query.get(key) ?? emptyState[key];
  }
  state.compare = [
    ...new Set((query.get("compare") ?? "").split(",").filter(Boolean)),
  ].slice(0, 5);
  if (
    !["name", "relevance", "stars", "reviewed", "updated"].includes(state.sort)
  )
    state.sort = "name";
  return state;
}
export function toHash(state: ViewState): string {
  const query = new URLSearchParams();
  for (const key of [
    ...filterKeys,
    "q",
    "sort",
    "repo",
    "view",
    "focus",
  ] as const) {
    if (state[key] && state[key] !== emptyState[key])
      query.set(key, state[key]);
  }
  if (state.compare.length) query.set("compare", state.compare.join(","));
  return `#/${query.size ? `?${query}` : ""}`;
}
const words: Record<string, string> = {
  ai: "AI",
  api: "API",
  apis: "APIs",
  cli: "CLI",
  tui: "TUI",
  ui: "UI",
  mcp: "MCP",
  llm: "LLM",
  llms: "LLMs",
  github: "GitHub",
  devops: "DevOps",
};
export function label(value: string | null | undefined): string {
  return value
    ? value
        .split("-")
        .map(
          (word, index) =>
            words[word] ??
            (index && ["and", "for", "of"].includes(word)
              ? word
              : word[0]?.toUpperCase() + word.slice(1)),
        )
        .join(" ")
    : "Unknown";
}
export function primaryTopic(repo: CatalogRepository): string {
  return repo.classification.topics[0] ?? "uncategorized";
}
export function filterValues(
  repo: CatalogRepository,
  key: FilterKey,
): string[] {
  switch (key) {
    case "category":
      return [repo.classification.primary_category ?? "unknown"];
    case "topic":
      return repo.classification.topics;
    case "language":
      return repo.technology.languages;
    case "technology":
      return repo.classification.technologies;
    case "license":
      return [repo.license.spdx ?? "unknown"];
    case "kind":
      return [repo.project.kind ?? "unknown"];
    case "lifecycle":
      return [repo.status.lifecycle ?? "unknown"];
    case "archived":
      return [
        repo.status.archived === null
          ? "unknown"
          : String(repo.status.archived),
      ];
    case "state":
      return [repo.research.state];
  }
}
export function facets(
  repositories: CatalogRepository[],
  key: FilterKey,
): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const repo of repositories)
    for (const value of new Set(filterValues(repo, key)))
      counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a.localeCompare(b, "en"));
}
export function selectRepositories(
  repositories: CatalogRepository[],
  search: SearchArtifact,
  state: ViewState,
): CatalogRepository[] {
  const texts = new Map(
    search.entries.map((entry) => [
      entry.id,
      entry.text.toLocaleLowerCase("en-US"),
    ]),
  );
  const terms = state.q
    .trim()
    .toLocaleLowerCase("en-US")
    .split(/\s+/)
    .filter(Boolean);
  const result = repositories.filter(
    (repo) =>
      filterKeys.every(
        (key) => !state[key] || filterValues(repo, key).includes(state[key]),
      ) && terms.every((term) => texts.get(repo.id)?.includes(term)),
  );
  const score = (repo: CatalogRepository) =>
    terms.reduce(
      (sum, term) =>
        sum +
        (repo.project.name.toLowerCase().includes(term) ? 8 : 0) +
        (`${repo.identity.owner}/${repo.identity.name} ${repo.identity.aliases.join(" ")}`
          .toLowerCase()
          .includes(term)
          ? 4
          : 0) +
        (repo.project.summary?.toLowerCase().includes(term) ? 2 : 0),
      0,
    );
  return result.sort((a, b) => {
    let diff = 0;
    if (state.sort === "stars") diff = b.github.stars - a.github.stars;
    if (state.sort === "reviewed")
      diff =
        timestamp(b.research.researched_at) -
        timestamp(a.research.researched_at);
    if (state.sort === "updated")
      diff = timestamp(b.github.pushed_at) - timestamp(a.github.pushed_at);
    if (state.sort === "relevance") diff = score(b) - score(a);
    return (
      diff ||
      a.project.name.localeCompare(b.project.name, "en") ||
      a.id.localeCompare(b.id, "en")
    );
  });
}
function timestamp(value: string | null): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}
export function assertCompatible(
  catalog: CatalogArtifact,
  search: SearchArtifact,
): void {
  if (
    catalog.schema_version !== 1 ||
    search.schema_version !== 1 ||
    search.catalog_schema_version !== 1 ||
    !Array.isArray(catalog.repositories) ||
    !Array.isArray(search.entries)
  )
    throw new Error(
      "Unsupported catalog format. Rebuild the application with current generated data.",
    );
  const ids = new Set(catalog.repositories.map((repo) => repo.id));
  const searchIds = new Set(search.entries.map((entry) => entry.id));
  if (
    ids.size !== catalog.repositories.length ||
    searchIds.size !== search.entries.length ||
    ids.size !== searchIds.size ||
    ids.size !== catalog.counts.repositories ||
    ids.size !== search.count ||
    [...ids].some((id) => !searchIds.has(id))
  )
    throw new Error(
      "Catalog and search index do not match. Regenerate both artifacts before building.",
    );
}
