# React catalog

The React application in `web/` consumes the existing versioned
`generated/catalog.json` and `generated/search-index.json`. It does not create a
second repository database. The Markdown catalog remains independently usable.

## Run locally

Use Node.js 24 LTS and install from the root of the repository:

```sh
npm ci
npm run dev:web
```

Open the printed local URL, including `/my-repo-radar/`. On Windows, use
`npm.cmd` if PowerShell blocks the npm script shim.

```sh
npm run build:web
npm run preview:web
```

The production build is written to ignored `dist-web/`, separate from the
catalog tools in `dist/`. `build:web` checks generated artifact freshness and
TypeScript before building. After changes to canonical YAML, run
`npm run generate` first. CI validates data, runs tests, and builds the web app.

## Browsing behavior

- The default overview lists each repository once, grouped by its **first
  listed topic**. There is no separately curated `primary_topic` field; the UI
  does not invent one or change the dossier taxonomy.
- A topic view includes all repositories carrying that topic, including
  secondary topics. A category view filters the single primary category.
- Topic links on a repository navigate directly to that repository in the
  topic view. Category and popular-topic navigation start a fresh view.
- Search uses all words, case-insensitively, against the generated search text,
  including aliases. Relevance sorting favors names and summaries. The first
  version deliberately does not add typo tolerance or a search service.
- Filters intersect: category, topic, language, technology, SPDX license,
  project kind, lifecycle, archive status, and research state. Facet counts
  describe the full catalog, not the currently narrowed result set.
- Unknown SPDX values remain unknown; mixed-license projects are not treated
  as permissively licensed. Read the detail's license scope before choosing.
- Sorting supports name, relevance, stars, last GitHub push, and last review.
  Stars are labeled as popularity; metadata is a snapshot, not live data.
- Details expose the complete compact overview, limitations, license scope,
  relevant release, source commit, evidence links, and research dates.
- Select two to five projects for a side-by-side comparison. Differences-only
  mode hides identical rows. No numeric quality or recommendation scores exist.
- Public filters, search, detail, and comparison selections live in hash URLs.
  Refresh, browser Back/Forward, and shared links work without server routes.
- Press `/` to focus search while browsing. Controls have accessible labels,
  visible focus, and a skip link. Comparison tables scroll on small screens.
- Light, dark, and system themes are supported. The choice is stored locally
  when browser storage is available. System mode follows OS changes; the
  initial theme is applied before React renders.

## Data and privacy boundary

The Vite build includes only explicitly imported public JSON plus application
assets; automatic public-directory copying is disabled. It never imports
research caches or workspace planning. No accounts, analytics, external fonts,
or third-party runtime APIs are used. External links open only when selected.

Theme preference lives in localStorage. The optional private workspace stores
only a selected-folder handle in IndexedDB; its notes live in one YAML file per
repository in the user's folder. Public comparison selections use the URL;
private notes and private filters do not. See [Private repository notes](personal-workspace.md)
for folder permissions, drafts, conflicts, backups, temporary mode, and ZIP/folder
import/export. Desktop cloud synchronization is external to the application.

## GitHub Pages

`web/vite.config.ts` sets `/my-repo-radar/` as the base path; navigation is
hash-based, so deep links need no server fallback. Change `base` if the hosting
path changes. Only `dist-web/` is deployable website output; never upload the
workspace or research cache.

The **Deploy React catalog** workflow is manual-only. Adding or pushing the
workflow does not publish the app. When deployment is authorized:

1. Commit and push the reviewed application and current generated artifacts.
2. In repository Settings → Pages, choose **GitHub Actions** as the source.
3. Run **Deploy React catalog** from Actions on `main`.
4. Verify the deployment's returned URL and a detail/comparison deep link.

The workflow validates and builds before uploading `dist-web/`, then deploys
through the `github-pages` environment. See GitHub's
[custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Verification

```sh
npm test
npm run validate
npm run build:web
git diff --check
```

The model tests cover every populated filter, secondary-topic membership,
search and aliases, sorting, URL state, unknown licensing, and compatibility of
the generated artifacts. Browser checks should cover both themes and system
mode, theme persistence, keyboard search, filters and empty results, detail
links, topic-to-repository focus, Back/Forward, comparison limits and shared
URLs, mobile layout, and load failures. Build success alone is not browser QA.

Local verification on 2026-11-22 passed 46 automated tests, validation of all 367
inventory/dossier pairs, generated-file freshness, and the production build.
Chromium checks exercised the behaviors above at desktop, 390px, and 320px
widths, including simulated failed fetches and unavailable browser storage.
No live GitHub Pages deployment or hosted cross-browser verification is claimed.
Private folder/ZIP transfer and conflict checks were also exercised; see the
[personal workspace verification scope](personal-workspace.md#verification-scope)
for the native-picker and cloud-sync checks still requiring user verification.
