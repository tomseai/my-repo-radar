# Classification Guide

The catalog classifies every repository starred by
[`tomseai`](https://github.com/tomseai?tab=stars). Classification describes
what a project is and how it can be used; it is not a quality score, popularity
ranking, or AI-only filter.

Controlled values are defined in [`data/taxonomy.yaml`](../data/taxonomy.yaml).
Use those values exactly. If none fits, choose `other` as the primary category
and request taxonomy review rather than inventing a new label.

## The four classification fields

| Field | Question answered | Cardinality | Example |
| --- | --- | --- | --- |
| `primary_category` | What kind of project is this primarily? | Exactly one after classification | `developer-tools` |
| `topics` | What concepts or cross-cutting capabilities does it concern? | Zero or more | `coding-agents`, `git`, `cli` |
| `use_cases` | What outcome can a developer use it to achieve? | Zero or more | `improve-developer-workflow` |
| `technologies` | Which implementation ecosystems are central to it? | Zero or more | `rust`, `typescript` |

The fields are deliberately separate. A Git client implemented in Rust is not
classified as `rust`; it may be a `developer-tools` project with the `git`
topic, the `improve-developer-workflow` use case, and `rust` technology. A web
framework is not classified as `web`; it may be an `application-frameworks`
project with `web` as a topic and `build-web-applications` as a use case.

## Primary category

Choose the category that best expresses the project's principal purpose, based
on its own documentation. Each analyzed record has one primary category.
Cross-cutting roles do not justify a second category: record them as topics or
use cases instead.

Use `ai-and-automation` for projects whose primary purpose is AI, agentic
systems, machine learning, or automation. Do not use it merely because a
project offers an AI feature. For example, a general editor with an optional
assistant remains a developer tool unless the assistant is its central
purpose.

Use `other` only when the current taxonomy cannot accurately represent the
project. Add a review note explaining the gap.

## Topics

Topics identify concepts, domains, or capabilities that can span categories.
They should make filtering easier without restating the primary category.
Assign a topic only when a primary source clearly demonstrates it. In
particular, do not assign `ai-agents`, `coding-agents`, `llms`, or
`machine-learning` based on a repository name, a GitHub topic, or an incidental
example.

Choose the narrowest topic directly supported by the project. `coding-agents`
is more informative than `ai-agents` for a coding-specific agent, while both
may be used when users need the broader discovery path. Do not confuse an
interface (`web-ui`, `desktop-app`) with a development domain
(`frontend-development`, `desktop-development`). Broad `web` and `search`
remain valid only when their narrower variants would misrepresent the project.

## Use cases

Use cases describe the practical outcome for a developer or team. They are
expressed as verbs or goals, such as `secure-software` or
`run-personal-or-team-tools`. A project can support several outcomes; select
only outcomes that are a normal and documented use of the repository, not a
theoretical possibility.

## Technologies

Technologies identify central languages, frameworks, runtimes, or platforms.
They are not an exhaustive dependency list. Include a technology when it is a
main implementation ecosystem, an explicit primary integration target, or
necessary to understand how the project is used. Do not infer technology from
an isolated file, transitive dependency, or generic ecosystem compatibility.

## Confidence and review

Set classification state to `provisional` when evidence supports a reasonable
classification but review is still warranted. Set it to `confirmed` only after
review. Leave it `unclassified` when evidence is insufficient.

Every non-obvious category, topic, use-case, or technology label needs a
matching evidence entry with a direct primary-source URL and verification date.
When sources conflict, preserve the conflict in the record and set
`analysis.state` to `needs-review`. Never resolve ambiguity by adding more
labels.

## Quick decision order

1. Read the repository description and README to identify the principal
   project purpose.
2. Choose one primary category from that purpose.
3. Add only documented cross-cutting topics.
4. Add documented user outcomes as use cases.
5. Add only central technologies.
6. Attach evidence, validate controlled values, and request review when the
   evidence or vocabulary is inadequate.
