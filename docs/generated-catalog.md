# Generated catalog artifacts

The JSON files in `generated/` and the Markdown catalog pages are deterministic public projections of the canonical YAML inventory and compact dossiers. Generated files must not be edited manually.

## `catalog.json`

`catalog.json` combines the imported GitHub snapshot, shallow inventory classification, and reviewed dossier fields without erasing their origin. Each repository contains identity, project description, classification, features, usage, technology, license, lifecycle, GitHub snapshot, research status, strengths, caveats, and primary sources.

The top-level `schema_version` versions the public artifact. `source_versions` records the inventory, dossier, and taxonomy versions used to build it. No generation timestamp is included, so unchanged inputs produce byte-identical output.

## `search-index.json`

`search-index.json` contains one compact entry per repository. Structured fields support filters for category, topics, kind, languages, technologies, license, lifecycle, archive state, confidence, and stars. The normalized lowercase `text` field combines the useful descriptive content for simple full-text or substring search.

## Markdown catalog

The root `README.md` is the main catalog. It lists every repository exactly once under its `primary_category`, with a short description and links to its topics.

Repository topic links include a stable identity-based fragment, so following a topic from the main catalog opens that topic page directly at the selected repository. Category and topic entries expose the same unique repository anchors.

`categories/<category>.md` provides a page for each used primary category. `topics/<topic>.md` provides a cross-category page for each used controlled topic. Category and topic pages add audience, kind, languages, license, lifecycle, stars, and key features to the short repository description.

## Commands

```sh
npm run generate
npm run check:generated
```

`npm run generate` rewrites both artifacts. `npm run check:generated` compares the committed artifacts with freshly generated content and fails when either file is missing or stale. The regular validation command and CI run this freshness check.

The artifact contracts are defined by `schema/catalog.schema.json` and `schema/search-index.schema.json`.
