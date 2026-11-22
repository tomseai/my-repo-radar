# Agent Instructions

## Scope

This repository catalogs all public GitHub repositories starred by `tomseai`.
Do not restrict collection or classification to AI-related projects.

## Data rules

- Keep imported GitHub metadata, agent analysis, and editorial curation in
  clearly separated fields.
- Use one source record per repository unless the schema documentation says
  otherwise.
- Preserve unknown values as `null` or an explicit `unknown` state. Never guess.
- Support multiple categories, but require one primary category after review.
- Treat GitHub stars as popularity context, not as a quality score.
- Attach a primary-source URL and verification date to non-obvious claims.
- Do not describe generic command-line compatibility as a native integration.
- Keep generated files deterministic and never edit them manually.

## Agent workflow

- Start repository additions and research refreshes with
  `docs/research-collection.md`; use `docs/agent-workflow.md` for batch ownership
  and the worker assignment template, and `docs/dossier-model.md` for completion.
- Work in focused batches and change only the records assigned to the batch.
- Preserve reviewed conclusions unless new evidence supports a change.
- Report redirects, repository transfers, archival, and conflicting evidence.
- Run validation before completing a batch.
- Keep all repository content, data, code, and documentation in English.
