# Compact Repository Dossier Model

Schema version 2 is frozen for the bulk dossier pass as of 2026-07-20. Bulk
agents may populate dossier records but must not change the schema, controlled
taxonomy, completion rules, or confidence rubric. Any newly discovered model
gap is reported to the root coordinator for a later versioned change.

Repository dossiers are concise, evidence-backed overviews for deciding whether
a project is worth opening, comparing, or trying. Imported inventory records
remain in `data/repositories/`; dossiers live in `data/dossiers/` and link back
through the stable `repository_id`.

The separation is intentional:

- inventory records contain reproducible GitHub facts;
- research bundles contain local commit-pinned source material;
- dossiers contain a quick evidence-backed interpretation;
- editorial recommendations remain a later, explicit curation step.

## Completion standard

A version 2 dossier is `complete` only when it contains:

- a primary category and useful controlled topics;
- a project kind, concise summary, and best-fit audience or workflow;
- at least three concrete key features;
- interfaces, installation methods, setup cost, and central technologies;
- explicit license information, including material restrictions;
- lifecycle, archive state, and latest release when one can be established;
- strengths and decision-relevant caveats;
- at least two primary source URLs;
- the exact research-bundle commit used for the analysis.

The dossier is not a replacement for upstream documentation. Architecture,
governance, detailed security behavior, exhaustive compatibility, and other
type-specific information are omitted unless they materially affect the
decision to inspect or use the project. Unknown information remains empty or
`null` rather than being inferred.

`status.latest_release` means the latest release relevant to the primary
project described by the dossier. When a monorepo feed publishes independent
package or component versions, select the most decision-relevant release and
state the ambiguity in `caveats`; do not silently present an internal package
release as the version of the whole project. Inspect the feed entries rather
than copying its first entry. Prefer the package that carries the repository's
primary product name. When the retained evidence contains only nightly,
preview, or unrelated component releases and no authoritative stable project
release can be identified, keep both release fields `null` and record the
newest observed non-stable entry in `caveats`.

## Evidence

Repository-file evidence should use immutable URLs pinned to the dossier's
`research.source_commit`. A release feed or official documentation URL may be
included when it supplies current information not represented by that commit.

The JSON Schema is
[`schema/repository-dossier.schema.json`](../schema/repository-dossier.schema.json).

## Research confidence

`research.confidence` measures confidence that the dossier accurately reflects
the retained primary sources. It is not a score for project quality,
trustworthiness, popularity, maturity, or maintainer reputation.

- `high`: all material claims are directly supported by sufficiently detailed
  primary sources; license and release scope are established or their absence
  is explicit; no unresolved contradiction changes the overview.
- `medium`: the main purpose is supported, but a material field depends on thin
  documentation, incomplete evidence, unclear reuse rights, or a disclosed
  source conflict that cannot be resolved from the bundle.
- `low`: the project's purpose or several material fields remain speculative,
  conflicting, or unsupported.

A small or unfamiliar repository may receive `high` when its dossier is narrow
and well supported. Conversely, a popular repository may receive `medium` or
`low`. Explicit `null` values do not automatically lower confidence when the
absence itself is well established, but adoption-critical uncertainty usually
does.
