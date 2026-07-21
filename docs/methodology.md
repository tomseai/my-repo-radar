# Methodology

The catalog starts with every public repository starred by the GitHub account
`tomseai`. Collection is intentionally broad: AI projects are one part of the
inventory rather than an inclusion requirement.

## Processing layers

Each repository record separates three layers:

1. **Imported facts** are reproducible GitHub metadata with collection
   provenance and timestamps.
2. **Analysis** is an evidence-backed description and classification drafted
   by an agent and subject to review.
3. **Curation** contains explicit editorial conclusions. It is never inferred
   from popularity alone.

A repository may exist in the inventory before it has been analyzed or
curated. Missing knowledge remains explicit instead of being guessed.

## Processing workflow

1. Import and deduplicate the complete starred collection.
2. Create or refresh one deterministic source record per repository.
3. Analyze records in focused batches without changing imported facts.
4. Validate structure, controlled vocabulary values, evidence, and identity.
5. Review uncertain or conflicting records separately.
6. Generate catalog views from validated source records.
