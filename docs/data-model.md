# Data model

The catalog contains every public GitHub repository starred by `tomseai`. It is not limited to AI projects.

Each repository has one source record in `data/repositories/`. Its stable identity is `id`, using the normalized form `github:owner/name`. Keep the repository's GitHub node ID when it is available and retain former names in `repository.aliases` after a rename or transfer.

## Record boundaries

The three top-level record sections have separate responsibilities:

- `repository` identifies the repository and must not contain an assessment.
- `import` contains observations imported from GitHub, including their provenance and fetch time. It is factual, time-dependent data rather than editorial content.
- `analysis` contains research, controlled classification, a concise factual summary, and evidence.
- `curation` contains public editorial conclusions. It may remain empty while a record is imported or researched.

Use `null` for an unknown scalar value and an explicit state such as `unstarted` or `unclassified` when work has not occurred. Do not use missing fields to mean unknown.

## Controlled vocabulary

`data/taxonomy.yaml` is the source of the allowed primary categories, topics, use cases, and technologies. Repository analysis may use only values defined there. A record can have several topics, use cases, and technologies, but it receives a primary category only after classification has progressed beyond `unclassified`.

## Source provenance

The stars importer writes a raw, deterministic JSON snapshot to `data/imports/`. The snapshot conforms to `schema/source-run.schema.json` and records the API base URL, import kind, GitHub username, repository payload, and the API's `starred_at` value when GitHub provides it.

For the catalog source, use the public starred-repositories endpoint for `tomseai`. The raw snapshot is import evidence; it is not a reviewed repository record. A repository record links to an import run through `import.sources[].source_id`, retains the observed time and source URL, and then stores a separately fetched GitHub metadata snapshot.

## States and evidence

Import states track collection and repository identity changes. Analysis states track the progress of research. Curation states track whether a public recommendation has been drafted, reviewed, or needs rechecking. These states are independent: an imported record is not automatically analyzed or recommended.

Every non-obvious statement in `analysis` or `curation` needs an evidence item with a claim, source URL, source type, verification date, and confidence. Prefer repository files, official documentation, releases, and maintainer announcements. GitHub topics and star counts can support discovery and context, but they do not establish capabilities or quality.

## Generated views

Validation loads every repository record, the taxonomy, and import snapshots against their schemas. Generation then sorts records by `id` and creates Markdown and machine-readable catalog views deterministically. Generated files are derived output and must not be edited manually.
