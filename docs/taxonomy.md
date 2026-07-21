# Taxonomy

Classification describes the whole starred collection, not only AI-related
projects.

- `primary_category` answers what kind of project the repository primarily is.
- `topics` describe concepts and cross-cutting features.
- `use_cases` describe what a developer would use the project to accomplish.
- `technologies` identify central implementation ecosystems.

Every analyzed repository has exactly one primary category. Topics, use cases,
and technologies are multi-value fields. Cross-cutting concerns belong in those
fields rather than being represented as multiple primary categories.

The controlled values live in [`data/taxonomy.yaml`](../data/taxonomy.yaml).
New values should be introduced only after reviewing whether an existing value
already represents the concept.

Topics are grouped for readability, but the groups are not stored on a
repository record. The vocabulary covers agent systems, agent development,
interfaces, capabilities, protocols and providers, operations and security,
developer workflow, general software development, UI and product concerns,
and learning resources.

Use the most specific supported topic. For example, prefer `coding-agents` to
the broader `ai-agents` when coding is the project's defining purpose. Use
`web-ui`, `web-search`, or `codebase-search` for those specific concepts;
retain `web` or `search` only when the repository genuinely concerns the
broader domain. Interface topics such as `desktop-app` are distinct from
implementation technologies and from development domains such as
`desktop-development`.
