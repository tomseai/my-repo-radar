# Compact Dossier Examples

These examples test a concise repository profile intended for fast scanning.
They deliberately omit details that are easier to inspect in the upstream
repository. The target is enough information to decide whether a project is
worth opening, comparing, or trying.

## GitButler

```yaml
schema_version: 2
repository_id: github:gitbutlerapp/gitbutler
research:
  state: complete
  source_commit: 7f74dbb5257b70b6a46f9ac1a820d8d4100d34b0
  bundle_collected_at: 2026-07-19T20:43:11.035Z
  researched_at: 2026-07-19T20:58:30.442Z
  confidence: high

classification:
  primary_category: developer-tools
  topics:
    - git
    - cli
    - desktop-app
    - automation
    - developer-productivity
    - code-review

project:
  name: GitButler
  kind: application
  summary: >-
    A desktop Git client and CLI for stacked and parallel branches, direct
    commit editing, conflict handling, undo, forge integration, and
    agent-assisted development.
  best_for:
    - Developers working with stacked pull requests
    - Managing several simultaneous branches or agent-produced changes

key_features:
  - Stacked and parallel branch workflows
  - Visual commit editing, splitting, moving, squashing, and rewording
  - Operation history with undo and recovery
  - Conflict-aware workflows
  - GitHub, GitLab, and Bitbucket integration
  - Shared Rust engine for the desktop app and but CLI

usage:
  interfaces:
    - desktop GUI
    - CLI
  installation:
    - official desktop download
    - build from source
  setup: moderate

technology:
  languages:
    - Rust
    - TypeScript
    - Svelte
  notable_components:
    - Tauri
    - SQLite

license:
  spdx: FSL-1.1-MIT
  name: Functional Source License 1.1 with MIT Future License
  notes: Competing commercial use is restricted; each version converts to MIT after two years.

status:
  lifecycle: active
  archived: false
  latest_release: nightly/0.5.2115
  latest_release_at: 2026-07-17

strengths:
  - Advanced Git workflows are available through both a GUI and CLI
  - Strong support for commit restructuring, conflicts, and recovery
  - Active development and explicit coding-agent integrations

caveats:
  - The current license is more restrictive than a permissive open-source license
  - Building the monorepo requires both Rust and JavaScript toolchains
  - Forge and AI features can require external accounts or providers

sources:
  - https://raw.githubusercontent.com/gitbutlerapp/gitbutler/7f74dbb5257b70b6a46f9ac1a820d8d4100d34b0/README.md
  - https://raw.githubusercontent.com/gitbutlerapp/gitbutler/7f74dbb5257b70b6a46f9ac1a820d8d4100d34b0/LICENSE.md
  - https://github.com/gitbutlerapp/gitbutler/releases.atom
```

## Serena

```yaml
schema_version: 2
repository_id: github:oraios/serena
research:
  state: complete
  source_commit: 5c85d961a0b32b98f2954508adf9dbccb655910e
  bundle_collected_at: 2026-07-19T20:44:44.213Z
  researched_at: 2026-07-19T20:58:30.442Z
  confidence: high

classification:
  primary_category: ai-and-automation
  topics:
    - ai-agents
    - llms
    - mcp
    - coding-agents
    - codebase-search
    - code-generation
    - developer-productivity
    - self-hosted

project:
  name: Serena
  kind: service
  summary: >-
    A local MCP coding toolkit that gives AI clients symbol-aware code search,
    navigation, editing, refactoring, and reusable project memory through
    language servers or an optional JetBrains backend.
  best_for:
    - Coding agents working in medium or large repositories
    - Reusing semantic code tools across different MCP clients and models

key_features:
  - Find symbols, declarations, implementations, and references
  - Retrieve focused symbol-level context instead of entire files
  - Apply symbol-aware edits and refactorings
  - Support for more than forty programming languages
  - Project memories and reusable instructions
  - Process, HTTP, and Docker deployment modes

usage:
  interfaces:
    - MCP server
    - CLI
    - local HTTP service
    - web dashboard
  installation:
    - uv or uvx
    - Python package
    - Docker
  setup: moderate

technology:
  languages:
    - Python
  notable_components:
    - Model Context Protocol
    - Language Server Protocol
    - pygls

license:
  spdx: MIT
  name: MIT License
  notes: null

status:
  lifecycle: active
  archived: false
  latest_release: v1.6.0
  latest_release_at: 2026-07-16

strengths:
  - More precise code operations than basic file and text tools
  - Broad language and MCP-client support
  - Self-hosted and independent of a specific language model

caveats:
  - Language-server setup and reliability vary by programming language
  - It augments a coding agent but does not provide the agent or model
  - The optional JetBrains backend is paid
  - HTTP deployments should not be exposed without suitable access controls

sources:
  - https://raw.githubusercontent.com/oraios/serena/5c85d961a0b32b98f2954508adf9dbccb655910e/README.md
  - https://raw.githubusercontent.com/oraios/serena/5c85d961a0b32b98f2954508adf9dbccb655910e/LICENSE
  - https://github.com/oraios/serena/releases.atom
```

## Proposed completion rule

A compact dossier should require a primary category, useful discovery topics,
a summary, at least three key features, one best-fit statement, license
information, project status, at least one strength, one caveat, and two primary
sources. Type-specific detail is included only when it materially changes a
reader's decision to inspect or try the project.
