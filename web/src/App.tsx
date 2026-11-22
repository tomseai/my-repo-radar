import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  emptyState,
  facets,
  filterKeys,
  label,
  parseHash,
  primaryTopic,
  selectRepositories,
  toHash,
  type CatalogArtifact,
  type CatalogRepository,
  type FilterKey,
  type SearchArtifact,
  type ViewState,
} from "../../src/web-model";
import {
  PersonalBadge,
  PersonalEditor,
  PersonalWorkspace,
  usePersonal,
} from "./personal/Personal";

const subscribe = (notify: () => void) => {
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
};
const number = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const date = (value: string | null) => (value ? value.slice(0, 10) : "Unknown");
const summary = (repo: CatalogRepository) =>
  repo.project.summary ?? repo.github.description ?? "No summary available.";
const license = (repo: CatalogRepository) =>
  repo.license.spdx ?? repo.license.name ?? "Unknown";
const join = (values: string[]) =>
  values.length ? values.join(", ") : "Not specified";
const filterLabels: Record<FilterKey, string> = {
  category: "Category",
  topic: "Topic",
  language: "Language",
  technology: "Technology",
  license: "License (SPDX)",
  kind: "Project kind",
  lifecycle: "Lifecycle",
  archived: "Archive status",
  state: "Research state",
};
function filterLabel(key: FilterKey, value: string) {
  if (key === "archived")
    return value === "true"
      ? "Archived"
      : value === "false"
        ? "Not archived"
        : "Unknown";
  return ["language", "license"].includes(key)
    ? value === "unknown"
      ? "Unknown"
      : value
    : label(value);
}
function External({ href, children }: { href: string; children: ReactNode }) {
  if (!/^https?:\/\//i.test(href)) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
function ThemePicker() {
  const [theme, setTheme] = useState(() => {
    try {
      const value = localStorage.getItem("repo-radar-theme");
      return value === "light" || value === "dark" ? value : "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    try {
      localStorage.setItem("repo-radar-theme", theme);
    } catch {
      /* Storage is optional. */
    }
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return (
    <label className="theme-picker">
      <span>Theme</span>
      <select
        aria-label="Theme"
        value={theme}
        onChange={(event) => setTheme(event.target.value)}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}

export function App({
  catalog,
  search,
}: {
  catalog: CatalogArtifact;
  search: SearchArtifact;
}) {
  const personal = usePersonal();
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  const state = useMemo(() => parseHash(hash), [hash]);
  const repositories = catalog.repositories;
  const byId = useMemo(
    () => new Map(repositories.map((repo) => [repo.id, repo])),
    [repositories],
  );
  const selected = state.compare.flatMap((id) =>
    byId.has(id) ? [byId.get(id)!] : [],
  );
  const [notice, setNotice] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const results = useMemo(
    () => selectRepositories(repositories, search, state),
    [repositories, search, state],
  );
  const allFacets = useMemo(
    () =>
      Object.fromEntries(
        filterKeys.map((key) => [key, facets(repositories, key)]),
      ) as Record<FilterKey, Array<[string, number]>>,
    [repositories],
  );
  const navigate = (patch: Partial<ViewState>, replace = false) => {
    const next = toHash({ ...parseHash(location.hash), focus: "", ...patch });
    if (next === location.hash) return;
    if (replace) {
      history.replaceState(null, "", next);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    } else location.hash = next;
  };
  const href = (patch: Partial<ViewState>) =>
    toHash({ ...state, focus: "", ...patch });
  const browseHref = (patch: Partial<ViewState>) =>
    toHash({ ...emptyState, compare: state.compare, ...patch });
  const toggleCompare = (repo: CatalogRepository) => {
    const ids = parseHash(location.hash).compare.filter((id) => byId.has(id));
    if (ids.includes(repo.id)) {
      navigate({ compare: ids.filter((id) => id !== repo.id) });
      setNotice(`${repo.project.name} removed from comparison.`);
    } else if (ids.length < 5) {
      navigate({ compare: [...ids, repo.id] });
      setNotice(`${repo.project.name} added to comparison.`);
    } else
      setNotice(
        "You can compare up to five repositories. Remove one to add another.",
      );
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement;
      if (
        event.key === "/" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) &&
        !element.isContentEditable
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  useEffect(() => {
    if (state.focus) {
      const target = document.getElementById(`repo-${state.focus}`);
      target?.scrollIntoView({ block: "center" });
      target?.focus({ preventScroll: true });
    } else {
      window.scrollTo(0, 0);
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [state.repo, state.view, state.topic, state.category, state.focus]);
  const detail = byId.get(state.repo);
  const title = state.repo
    ? (detail?.project.name ?? "Repository not found")
    : state.view === "personal"
      ? "Private workspace"
      : state.view === "compare"
        ? "Compare repositories"
        : state.topic
          ? label(state.topic)
          : state.category
            ? label(state.category)
            : "Find your next useful repo.";
  useEffect(() => {
    document.title = `${title} · My Repo Radar`;
  }, [title]);
  const compareButton = (repo: CatalogRepository) => (
    <button
      className={`compare-toggle ${selected.some((item) => item.id === repo.id) ? "selected" : ""}`}
      aria-pressed={selected.some((item) => item.id === repo.id)}
      aria-label={`Compare ${repo.project.name}`}
      onClick={() => toggleCompare(repo)}
    >
      {selected.some((item) => item.id === repo.id)
        ? "✓ Selected"
        : "+ Compare"}
    </button>
  );
  const renderRow = (repo: CatalogRepository) => (
    <article
      className="repo-row"
      id={`repo-${repo.id}`}
      tabIndex={-1}
      key={repo.id}
    >
      <div className="repo-copy">
        <div className="repo-title">
          <a href={href({ repo: repo.id })}>{repo.project.name}</a>
          <span className="owner">
            {repo.identity.owner}/{repo.identity.name}
          </span>
          {repo.status.archived && <span className="badge">Archived</span>}
        </div>
        <PersonalBadge repo={repo} />
        <p>{summary(repo)}</p>
        <div className="tags">
          {repo.classification.topics.map((topic) => (
            <a key={topic} href={browseHref({ topic, focus: repo.id })}>
              {label(topic)}
            </a>
          ))}
        </div>
      </div>
      <div className="repo-meta">
        <span>{repo.technology.languages[0] ?? "Language unknown"}</span>
        <span>{license(repo)}</span>
        <span
          title={`${repo.github.stars.toLocaleString("en")} stars at snapshot ${date(repo.github.fetched_at)}. Popularity, not quality.`}
        >
          ☆ {number.format(repo.github.stars)}
        </span>
        {compareButton(repo)}
      </div>
    </article>
  );
  const groups = new Map<string, CatalogRepository[]>();
  for (const repo of results) {
    const key = primaryTopic(repo);
    groups.set(key, [...(groups.get(key) ?? []), repo]);
  }
  const grouped = !state.topic && !state.q && state.sort === "name";
  const activeFilters = filterKeys.filter((key) => state[key]);
  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="topbar">
        <a className="brand" href={browseHref({})}>
          <span className="radar-mark" aria-hidden="true" />
          <span>
            my repo<span className="brand-accent"> radar</span>
          </span>
        </a>
        <div className="top-actions">
          <span className="collection-label">
            A personal collection, openly shared.
          </span>
          <External href="https://github.com/tomseai/my-repo-radar">
            GitHub catalog
          </External>
          <ThemePicker />
          <a className="personal-link" href={browseHref({ view: "personal" })}>
            Private workspace{personal.hasDrafts ? " •" : ""}
          </a>
        </div>
      </header>
      <div className="app-layout">
        <aside className="sidebar">
          <a
            className={`nav-all ${!state.category && !state.topic ? "active" : ""}`}
            href={browseHref({})}
          >
            All repositories <span>{repositories.length}</span>
          </a>
          <details open className="sidebar-section">
            <summary>Categories</summary>
            <nav aria-label="Categories">
              {allFacets.category.map(([category, count]) => (
                <a
                  key={category}
                  aria-current={
                    state.category === category ? "page" : undefined
                  }
                  href={browseHref({ category })}
                >
                  <span>{label(category)}</span>
                  <span className="count">{count}</span>
                </a>
              ))}
            </nav>
          </details>
          <details open className="sidebar-section">
            <summary>Popular topics</summary>
            <nav aria-label="Popular topics">
              {[...allFacets.topic]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([topic, count]) => (
                  <a
                    key={topic}
                    aria-current={state.topic === topic ? "page" : undefined}
                    href={browseHref({ topic })}
                  >
                    <span>{label(topic)}</span>
                    <span className="count">{count}</span>
                  </a>
                ))}
            </nav>
          </details>
          <p className="sidebar-note">
            Picked by a person.
            <br />
            Summarized from sources.
            <br />
            Stars aren’t a quality score.
          </p>
        </aside>
        <main id="main" tabIndex={-1} className="main-content">
          <div className="eyebrow">THE OPEN-SOURCE SHELF</div>
          {(state.repo ||
            state.view === "compare" ||
            state.view === "personal") && (
            <a className="back-link" href={href({ repo: "", view: "" })}>
              Back to results
            </a>
          )}
          <h1 tabIndex={-1} ref={headingRef}>
            {title}
          </h1>
          {state.repo ? (
            detail ? (
              <RepositoryDetail
                repo={detail}
                browseHref={browseHref}
                compare={compareButton(detail)}
              />
            ) : (
              <div className="empty">
                <p>This repository is not in this catalog snapshot.</p>
                <a href={browseHref({})}>Browse all repositories</a>
              </div>
            )
          ) : state.view === "personal" ? (
            <PersonalWorkspace
              repositoryHref={(id) => href({ view: "", repo: id })}
            />
          ) : state.view === "compare" ? (
            <Comparison
              repositories={selected}
              compareButton={compareButton}
              href={href}
            />
          ) : (
            <>
              <p className="intro">
                {state.topic
                  ? state.category
                    ? `Repositories tagged with this topic in ${label(state.category)}.`
                    : "Every repository tagged with this topic, across categories."
                  : state.category
                    ? "A focused shelf of projects, with the context to choose."
                    : "Useful projects, clear summaries, and the details that matter. Explore beyond the star count."}
              </p>
              <section className="search-panel" aria-label="Search and filters">
                <label className="search-box">
                  <span className="search-icon" aria-hidden="true">
                    ⌕
                  </span>
                  <span className="sr-only">Search repositories</span>
                  <input
                    ref={searchRef}
                    type="search"
                    placeholder="Search repos, capabilities, or tools…"
                    value={state.q}
                    onChange={(event) =>
                      navigate(
                        {
                          q: event.target.value,
                          sort:
                            event.target.value && state.sort === "name"
                              ? "relevance"
                              : !event.target.value &&
                                  state.sort === "relevance"
                                ? "name"
                                : state.sort,
                        },
                        true,
                      )
                    }
                  />
                  <kbd aria-hidden="true">/</kbd>
                </label>
                <div className="filter-row">
                  {(["topic", "language", "license"] as FilterKey[]).map(
                    (key) => (
                      <Filter
                        key={key}
                        name={key}
                        values={allFacets[key]}
                        value={state[key]}
                        onChange={(value) => navigate({ [key]: value })}
                      />
                    ),
                  )}
                  <details className="more-filters">
                    <summary>
                      More filters
                      {activeFilters.some(
                        (key) =>
                          !["topic", "language", "license"].includes(key),
                      )
                        ? " •"
                        : ""}
                    </summary>
                    <div>
                      {(
                        [
                          "category",
                          "technology",
                          "kind",
                          "lifecycle",
                          "archived",
                          "state",
                        ] as FilterKey[]
                      ).map((key) => (
                        <Filter
                          key={key}
                          name={key}
                          values={allFacets[key]}
                          value={state[key]}
                          onChange={(value) => navigate({ [key]: value })}
                        />
                      ))}
                    </div>
                  </details>
                </div>
                {(activeFilters.length > 0 || state.q) && (
                  <div className="active-filters">
                    {activeFilters.map((key) => (
                      <button
                        key={key}
                        onClick={() => navigate({ [key]: "" })}
                        aria-label={`Remove ${filterLabels[key]} filter`}
                      >
                        {filterLabel(key, state[key])}{" "}
                        <span aria-hidden="true">×</span>
                      </button>
                    ))}
                    <button
                      className="text-button"
                      onClick={() =>
                        navigate({ ...emptyState, compare: state.compare })
                      }
                    >
                      Clear filters and search
                    </button>
                  </div>
                )}
              </section>
              <div className="results-toolbar">
                <p role="status">
                  <strong>{results.length}</strong> of {repositories.length}{" "}
                  repositories
                  {grouped && (
                    <span className="group-note"> · By first listed topic</span>
                  )}
                </p>
                <label>
                  Sort by{" "}
                  <select
                    aria-label="Sort by"
                    value={state.sort}
                    onChange={(event) => navigate({ sort: event.target.value })}
                  >
                    <option value="name">Name</option>
                    <option value="relevance">Relevance</option>
                    <option value="stars">Stars (popularity)</option>
                    <option value="updated">Last GitHub push</option>
                    <option value="reviewed">Last reviewed</option>
                  </select>
                </label>
              </div>
              {!results.length ? (
                <div className="empty">
                  <h2>No matches on this shelf.</h2>
                  <p>Try fewer filters or a broader search.</p>
                  <button
                    onClick={() =>
                      navigate({ ...emptyState, compare: state.compare })
                    }
                  >
                    Reset search and filters
                  </button>
                </div>
              ) : grouped ? (
                [...groups]
                  .sort(([a], [b]) => label(a).localeCompare(label(b), "en"))
                  .map(([topic, repos]) => (
                    <section key={topic} className="topic-group">
                      <div className="group-heading">
                        <h2>
                          <a
                            href={browseHref({
                              topic: topic === "uncategorized" ? "" : topic,
                            })}
                          >
                            {label(topic)}
                          </a>
                        </h2>
                        <span>{repos.length}</span>
                      </div>
                      {repos.map(renderRow)}
                    </section>
                  ))
              ) : (
                <section
                  className="topic-group"
                  aria-label="Repository results"
                >
                  {results.map(renderRow)}
                </section>
              )}
            </>
          )}
          <footer className="footer">
            Built from reviewed repository snapshots, not live GitHub data.{" "}
            <External href="https://github.com/tomseai/my-repo-radar">
              Browse sources and methodology
            </External>
          </footer>
        </main>
      </div>
      <div className="sr-only" role="status">
        {notice}
      </div>
      {selected.length > 0 && (
        <section className="compare-tray" aria-label="Comparison selection">
          <div>
            <strong>{selected.length} / 5 selected</strong>
            <span>{selected.map((repo) => repo.project.name).join(" · ")}</span>
          </div>
          <div className="tray-actions">
            <button
              className="text-button"
              onClick={() => navigate({ compare: [], view: "" })}
            >
              Clear
            </button>
            {state.view === "compare" && !state.repo ? (
              <a className="primary-button" href={href({ view: "" })}>
                Add repositories
              </a>
            ) : selected.length >= 2 ? (
              <a
                className="primary-button"
                href={href({ repo: "", view: "compare" })}
              >
                Compare {selected.length} repos
              </a>
            ) : (
              <button disabled>Select one more</button>
            )}
          </div>
        </section>
      )}
    </>
  );
}

function Filter({
  name,
  value,
  values,
  onChange,
}: {
  name: FilterKey;
  value: string;
  values: Array<[string, number]>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="filter">
      <span>{filterLabels[name]}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Any {filterLabels[name].toLowerCase()}</option>
        {value && !values.some(([item]) => item === value) && (
          <option value={value}>{value} (0)</option>
        )}
        {values.map(([item, count]) => (
          <option key={item} value={item}>
            {filterLabel(name, item)} ({count})
          </option>
        ))}
      </select>
    </label>
  );
}
function List({ values }: { values: string[] }) {
  return values.length ? (
    <ul>
      {values.map((value, index) => (
        <li key={`${index}-${value}`}>{value}</li>
      ))}
    </ul>
  ) : (
    <p className="muted">Not specified.</p>
  );
}
function RepositoryDetail({
  repo,
  browseHref,
  compare,
}: {
  repo: CatalogRepository;
  browseHref: (state: Partial<ViewState>) => string;
  compare: ReactNode;
}) {
  return (
    <div className="repository-detail">
      <p className="detail-owner">
        {repo.identity.owner}/{repo.identity.name}
      </p>
      <p className="detail-summary">{summary(repo)}</p>
      <div className="detail-actions">
        <External href={repo.identity.url}>Open on GitHub</External>
        {compare}
        <a
          href={browseHref({
            category: repo.classification.primary_category ?? "unknown",
            focus: repo.id,
          })}
        >
          {label(repo.classification.primary_category)}
        </a>
      </div>
      <div className="tags detail-tags">
        {repo.classification.topics.map((topic) => (
          <a href={browseHref({ topic, focus: repo.id })} key={topic}>
            {label(topic)}
          </a>
        ))}
      </div>
      <dl className="facts">
        <div>
          <dt>Kind</dt>
          <dd>{label(repo.project.kind)}</dd>
        </div>
        <div>
          <dt>Lifecycle</dt>
          <dd>
            {label(repo.status.lifecycle)}
            {repo.status.archived ? " · Archived" : ""}
          </dd>
        </div>
        <div>
          <dt>License</dt>
          <dd>{license(repo)}</dd>
        </div>
        <div>
          <dt>Latest relevant release</dt>
          <dd>
            {repo.status.latest_release ?? "Not established"}
            <small>
              {repo.status.latest_release_at
                ? date(repo.status.latest_release_at)
                : ""}
            </small>
          </dd>
        </div>
      </dl>
      <PersonalEditor repo={repo} />
      <div className="detail-grid">
        <section>
          <h2>Best for</h2>
          <List values={repo.project.best_for} />
        </section>
        <section>
          <h2>Key features</h2>
          <List values={repo.key_features} />
        </section>
        <section>
          <h2>Strengths</h2>
          <List values={repo.strengths} />
        </section>
        <section className="caveats">
          <h2>Worth knowing</h2>
          <List values={repo.caveats} />
        </section>
        <section>
          <h2>Getting started</h2>
          <dl className="stacked-facts">
            <dt>Interfaces</dt>
            <dd>{join(repo.usage.interfaces)}</dd>
            <dt>Installation</dt>
            <dd>
              <List values={repo.usage.installation} />
            </dd>
            <dt>Setup effort</dt>
            <dd>{label(repo.usage.setup)}</dd>
          </dl>
        </section>
        <section>
          <h2>Under the hood</h2>
          <dl className="stacked-facts">
            <dt>Languages</dt>
            <dd>{join(repo.technology.languages)}</dd>
            <dt>Notable components</dt>
            <dd>{join(repo.technology.notable_components)}</dd>
            <dt>License scope</dt>
            <dd>
              {repo.license.notes ??
                "Not specified. Review the upstream license before use."}
            </dd>
          </dl>
        </section>
      </div>
      <section className="evidence">
        <h2>Evidence, not a quality score</h2>
        <p>
          Research confidence:{" "}
          <strong>{label(repo.research.confidence)}</strong>. This describes how
          well the summary is supported, not whether the project is good or
          safe.
        </p>
        <dl className="facts">
          <div>
            <dt>Last reviewed</dt>
            <dd>{date(repo.research.researched_at)}</dd>
          </div>
          <div>
            <dt>GitHub snapshot</dt>
            <dd>{date(repo.github.fetched_at)}</dd>
          </div>
          <div>
            <dt>Stars at snapshot</dt>
            <dd>
              {repo.github.stars.toLocaleString("en")}{" "}
              <small>Popularity only</small>
            </dd>
          </div>
          <div>
            <dt>Last GitHub push</dt>
            <dd>{date(repo.github.pushed_at)}</dd>
          </div>
        </dl>
        <p className="source-commit">
          Source commit <code>{repo.research.source_commit}</code>
        </p>
        <ul className="sources">
          {repo.sources.map((source) => (
            <li key={source}>
              <External href={source}>{source}</External>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
function Comparison({
  repositories,
  compareButton,
  href,
}: {
  repositories: CatalogRepository[];
  compareButton: (repo: CatalogRepository) => ReactNode;
  href: (patch: Partial<ViewState>) => string;
}) {
  const [differencesOnly, setDifferencesOnly] = useState(false);
  if (repositories.length < 2)
    return (
      <div className="empty">
        <p>
          Select two to five repositories to compare their documented
          trade-offs.
        </p>
        <a href={href({ view: "" })}>Choose repositories</a>
      </div>
    );
  const rows: Array<[string, (repo: CatalogRepository) => string | string[]]> =
    [
      ["Summary", summary],
      ["Best for", (repo) => repo.project.best_for],
      ["Category", (repo) => label(repo.classification.primary_category)],
      ["Topics", (repo) => repo.classification.topics.map(label)],
      ["Kind", (repo) => label(repo.project.kind)],
      ["Key features", (repo) => repo.key_features],
      ["Interfaces", (repo) => repo.usage.interfaces],
      ["Installation", (repo) => repo.usage.installation],
      ["Setup effort", (repo) => label(repo.usage.setup)],
      ["Languages", (repo) => repo.technology.languages],
      ["Components", (repo) => repo.technology.notable_components],
      ["License", license],
      ["License scope", (repo) => repo.license.notes ?? "Unknown"],
      ["Lifecycle", (repo) => label(repo.status.lifecycle)],
      [
        "Archived",
        (repo) =>
          repo.status.archived === null
            ? "Unknown"
            : repo.status.archived
              ? "Yes"
              : "No",
      ],
      [
        "Relevant release",
        (repo) => repo.status.latest_release ?? "Not established",
      ],
      ["Strengths", (repo) => repo.strengths],
      ["Worth knowing", (repo) => repo.caveats],
      ["Reviewed", (repo) => date(repo.research.researched_at)],
      ["Evidence confidence", (repo) => label(repo.research.confidence)],
    ];
  return (
    <section>
      <p className="intro">
        Compare documented capabilities and trade-offs. No rankings or invented
        scores.
      </p>
      <label className="difference-toggle">
        <input
          type="checkbox"
          checked={differencesOnly}
          onChange={(event) => setDifferencesOnly(event.target.checked)}
        />{" "}
        Show differences only
      </label>
      <div
        className="comparison-scroll"
        tabIndex={0}
        role="region"
        aria-label="Repository comparison table"
      >
        <table className="comparison-table">
          <caption className="sr-only">
            Comparison of{" "}
            {repositories.map((repo) => repo.project.name).join(", ")}
          </caption>
          <thead>
            <tr>
              <th scope="col">At a glance</th>
              {repositories.map((repo) => (
                <th scope="col" key={repo.id}>
                  <a href={href({ view: "", repo: repo.id })}>
                    {repo.project.name}
                  </a>
                  {compareButton(repo)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows
              .filter(
                ([, get]) =>
                  !differencesOnly ||
                  new Set(repositories.map((repo) => JSON.stringify(get(repo))))
                    .size > 1,
              )
              .map(([title, get]) => (
                <tr key={title}>
                  <th scope="row">{title}</th>
                  {repositories.map((repo) => {
                    const value = get(repo);
                    return (
                      <td key={repo.id}>
                        {Array.isArray(value) ? <List values={value} /> : value}
                      </td>
                    );
                  })}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
