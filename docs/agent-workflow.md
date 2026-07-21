# Agent Batch Workflow

This workflow processes the complete public GitHub repository collection starred
by [`tomseai`](https://github.com/tomseai?tab=stars). It does not filter the
collection to AI-related repositories. AI and automation are one classification
area among many.

## Record ownership

The importer creates one deterministic source record for each canonical GitHub
repository. A batch agent may change only the records explicitly assigned to
its batch. It must not edit generated indexes, imported GitHub facts, another
agent's records, or the controlled vocabulary.

Repository identity comes from the canonical `owner/name` pair and GitHub node
ID. A redirect, rename, transfer, archive, duplicate, unavailable repository,
or conflicting source must be reported in the record rather than silently
resolved by guessing.

## Inventory batch contract

Terra agents work on focused batches of 12 imported records. A smaller batch of
six records is used for records that need additional review. The coordinator
keeps one execution slot free for importing, validation, and hand-off work;
the remaining available slots may process independent batches in parallel.

For every assigned record, the agent must:

1. Preserve the `repository` and `import` sections as imported.
2. Read the repository metadata and README first. Use official documentation,
   release notes, or maintainer announcements only when they are needed to
   support a claim.
3. Set `analysis.state` and `analysis.classification.state` to reflect the
   evidence actually found.
4. Write an original, neutral English `one_line` summary and `why_useful`
   explanation only when the evidence supports them.
5. Add an evidence item for every non-obvious summary or classification claim.
6. Leave uncertain fields empty or `null` and set `analysis.state` to
   `needs-review`; never fill a gap with a plausible inference.
7. Run validation and report the batch outcome, including records that need
   review.

An agent may complete a record as `researched` when its purpose and
classification have sufficient primary-source evidence. It may use `complete`
only after the record has passed validation and contains no unresolved analysis
questions. `needs-review` is a valid outcome, not a failure.

## Evidence requirements

Each `analysis.evidence` entry must conform to the repository schema and
contain all of the following:

- the precise claim it supports;
- a supported primary `source_type`;
- the direct source URL;
- the date it was checked; and
- a realistic confidence level.

Repository files and official project documentation are preferred. GitHub
metadata may support factual attributes such as language, archive state, and
repository topics, but topics and names alone do not prove product
capabilities. Do not treat a generic command-line interface as a native
integration.

## Triage states

The importer uses `import.state` for collection facts. Analysis uses the
following `analysis.state` values:

| State | Meaning |
| --- | --- |
| `unstarted` | Imported but not yet assigned or analyzed. |
| `triaged` | Basic source review is complete; fuller research remains. |
| `researched` | Evidence supports a summary and provisional classification. |
| `needs-review` | Evidence is missing, unclear, conflicting, or needs a human decision. |
| `complete` | Analysis is evidence-backed and passes validation. |
| `stale` | Earlier analysis may no longer describe the current repository. |

Editorial recommendations belong exclusively in `curation`. Batch agents must
not infer a recommendation from stars, activity, personal preference, or
classification.

## Compact dossier batches

After inventory and local source collection, dossier agents work only on the
files explicitly assigned to them under `data/dossiers/`. They use the matching
commit-pinned bundle in `.research-cache/repositories/` as their default source
set and must not alter inventory facts or the controlled taxonomy.

A complete compact dossier must follow schema version 2 and the completion
rules in [`dossier-model.md`](dossier-model.md). It should normally remain
within roughly 60-90 YAML lines. The goal is a quick, useful overview rather
than a substitute for upstream documentation. Topics, license, lifecycle,
strengths, and decision-relevant caveats are required. At least one evidence
URL must be pinned to the dossier's `research.source_commit`.

Agents must use only controlled topics, record release ambiguity explicitly,
and avoid forcing application-specific detail onto libraries, courses,
curated lists, protocols, or other project kinds. Every batch is validated,
then reviewed separately for consistency across comparable repositories.

For release fields, never copy the first entry from `releases.atom` without
checking its title. Monorepo feeds may be ordered by auxiliary-package
releases, and project feeds may contain only nightlies. Select the release of
the primary project or package. If the bundle cannot establish one, leave the
release fields `null` and explain the observed feed in `caveats`.

Calibrate `research.confidence` using the rubric in `dossier-model.md`; do not
default it to `high`. Confidence describes source support for the dossier, not
whether a project is good, safe, popular, or reputable. Thin documentation,
unclear reuse rights, or an unresolved material conflict normally caps a
dossier at `medium`, even when the uncertainty is disclosed correctly.

Treat stars and forks only as mutable popularity context. Extreme growth or
inconsistent popularity displays may be flagged neutrally for later curation,
but ratios and custom badges do not prove manipulation. Never accuse a project
of artificial popularity without direct evidence.

## Mechanical review

Before a batch is accepted, validate every changed record and check that:

- its file name, `id`, canonical owner/name, GitHub URL, and node ID identify
  the same repository;
- the record contains exactly the schema-defined sections and required fields;
- imported facts were not changed by the analysis batch;
- `primary_category` is either `null` for unclassified work or exactly one
  allowed value;
- label lists contain no duplicates and use only controlled vocabulary values;
- every non-obvious claim has a direct primary-source URL and verification
  date;
- summaries are neutral, original, and supported by the evidence;
- unknown values remain explicit; and
- reviewed conclusions are preserved unless the changed evidence justifies a
  correction.

Validation failures return only the affected records to a review batch. A
valid record is retained even when another record in the same batch needs
review.
