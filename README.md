# buggy

A Claude Code plugin for spec-driven development with semantic versioning and git.

> **Status:** 1.1.0 – stable. Used on real projects: adopting an existing spec-driven practice and setting up a project without one, each followed by shipped and released versions (see [`docs/manual-tests.md`](docs/manual-tests.md)).

## What it does

`buggy` guides a project from an idea to a released version:

```
idea → new → clarify → plan → implement → review → ship → (release)
```

- Every change lives on its own branch and in its own folder (`changes/YYYYMMDD-short-name/`).
- The version number is assigned only when the change ships (SemVer: major / minor / bugfix).
- Everything is kept in files in your repository: specifications, plans, history, reviews, project knowledge (`.buggy/`).
- **You decide.** The plugin never commits application code, merges or pushes without your explicit consent.
- Technology-agnostic: knowledge about your stack lives in your project, not in the plugin.

## Commands

| Command | Purpose |
|---|---|
| `/buggy:start` | Set up buggy in a new or existing project |
| `/buggy:version` | Current version and project state |
| `/buggy:new-idea` | Save an idea for later |
| `/buggy:new` | Start a new change (branch + specification) |
| `/buggy:clarify` | Analyse the specification and resolve open questions |
| `/buggy:plan` | Prepare the implementation plan |
| `/buggy:implement` | Implement the accepted plan |
| `/buggy:review` | Review the implementation, iterate on fixes |
| `/buggy:ship` | Ship the approved change: version number, release note, merge instructions |
| `/buggy:release` | Publish a released version (default the latest) following the project's procedure |
| `/buggy:doctor` | Check project consistency (`full`: requirements vs code, stack vs dependencies, documents) |

## Requirements

- [Claude Code](https://code.claude.com) (CLI, IDE extensions, or the Code tab in Claude Desktop)
- Node.js ≥ 20
- git

## Installation

In a terminal:

```bash
claude plugin marketplace add marioosh/claude-plugins
claude plugin install buggy@nosinski
```

or inside Claude Code: `/plugin marketplace add marioosh/claude-plugins`, then
`/plugin install buggy@nosinski`.

Both commands take `--scope user` (default – all your projects), `--scope project`
(written to `.claude/settings.json`, shared with the team) or `--scope local` (this
project only, not committed). Start a new Claude Code session afterwards.

## Quick start

In the project's folder, in Claude Code:

1. `/buggy:start` – buggy looks at the folder (new project, existing project, existing
   spec-driven practice), asks a few questions and sets up `.buggy/`, the `CLAUDE.md`
   block and the git hooks on a separate branch. You merge it.
2. `/buggy:new bugfix "short description"` (or `minor` / `major`, or `/buggy:new-idea`
   to keep it for later) – a branch `feature/<id>` and `changes/<id>/spec.md`.
3. `/buggy:clarify` → `/buggy:plan` → `/buggy:implement` → `/buggy:review` (and
   `/buggy:review final`) → `/buggy:ship`.
4. You merge the change into the main branch; the git hook tags the new version
   (`vX.Y.Z`). Pushing is always yours.
5. Optionally `/buggy:release` – publish that version following a procedure you write
   together the first time (`.buggy/release.md`).

`/buggy:version` shows where you are; `/buggy:doctor` (and `/buggy:doctor full`) checks
the project's consistency.

## Security

buggy runs scripts in your repository with your permissions. It protects against common mistakes and basic attacks (no shell interpolation, no writes outside the repository or through symlinks), but it **cannot protect you against every scenario in a malicious repository**. Use it on repositories you trust, and review unfamiliar repositories before running any tooling on them.

## Development

See [`docs/development.md`](docs/development.md).

## Author

Mariusz Nosiński – [nosinski.pl](https://nosinski.pl)

## License

MIT – see [LICENSE](LICENSE).
