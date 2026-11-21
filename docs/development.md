# Developing buggy

## Requirements

- Node.js ≥ 20 (no npm dependencies – only the standard library)
- git ≥ 2.23
- Claude Code (for manual testing and `claude plugin validate`)

## Layout

```
.claude-plugin/marketplace.json   marketplace "nosinski" → plugins/buggy
plugins/buggy/                    the plugin (the only part that gets installed)
  .claude-plugin/plugin.json
  skills/<name>/SKILL.md          one skill per command (/buggy:<name>)
  hooks/hooks.json                SessionStart + PreToolUse (Bash, Write)
  hooks/*.sh                      POSIX sh wrappers (cheap filters before Node)
  scripts/run.sh                  single entry point for skills
  scripts/<name>.mjs              deterministic logic, JSON output
  scripts/lib/*.mjs               shared modules
  templates/                      files created in the user's project
tests/                            node:test, not installed
docs/                             developer documentation, not installed
```

## Commands

```bash
npm test                          # all tests
node --test tests/change.test.mjs # one file
npm run validate                  # claude plugin validate (marketplace + plugin)
```

GitHub Actions (`.github/workflows/test.yml`) runs `npm test` on Node 20 and 22 for every
push to `main` and every pull request; `claude plugin validate` stays a local step.

Try the plugin in a scratch repository without installing it:

```bash
claude --plugin-dir /path/to/mario_buggy_plugin/plugins/buggy
```

After editing skills, run `/reload-plugins` in the session.

## Rules for scripts

- **Skills call scripts only through `run.sh`:**
  `` !`sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh <script> [args]` `` with
  `allowed-tools: Bash(sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh *)`.
  A `!` command is permission-checked like any Bash command; a compound command
  (`a && b || c`) needs approval for every part, so the Node check lives in `run.sh`.
  `run.sh` never fails: a missing or old Node gives a JSON error with exit code 0.
- **Output contract:** one JSON object on stdout. `{"status":"ok", …}` or
  `{"status":"error","code":"…","message":"…","details"?}` with exit code 1.
  `state.mjs` always exits 0 and turns partial failures into `warnings`.
  Every command a skill injects with !`…` (`state`, `setup detect`, `ideas list`,
  `doctor check`) exits 0 even on error (`run(…, { alwaysZero: [<subcommands>] })`):
  Claude Code aborts the whole skill when an injected command fails, before the
  skill can explain anything. A contract test runs every injected command outside
  git and in a repository without buggy.
- **Text from the model never goes through command-line arguments.** Titles,
  commit messages and reasons come from a JSON file written by the model with
  the Write tool in `.buggy/.tmp/` (a new file name every time): `--input <file>`.
  The script deletes the file after reading it. A heredoc does not work: Claude
  Code's Bash safety check rejects `{"…` inside it (D-40).
- **Permissions across dialog turns:** a skill's `allowed-tools` covers only the
  turn that invoked it. The PreToolUse hook (`scripts/lib/guard.mjs`) therefore
  approves exactly buggy's own calls in later turns – `sh <plugin>/scripts/run.sh
  <name> <safe args>` and Write of `*.json` inside `<project>/.buggy/.tmp/` – and
  nothing else. The user's deny/ask rules still win (D-42).
- **Files only through `lib/fsutil.mjs`:** paths inside the repository, no
  symlinks (read or write), size limits, atomic writes.
- **git only through `lib/git.mjs`:** `execFile` without a shell, paths after `--`.
- **Commits:** `commit-docs` for buggy documents only (`changes/`, `ideas/`,
  `releases/`, `.buggy/`), never on the main branch; everything else through
  `commit-plan` (preview + token) → user says yes → `commit-do --token`.

## Scripts

| Script | Commands |
|---|---|
| `state` | full project state (no arguments); `change.branchWork` – commits and files on the change branch since it left the main branch, without the change's own folder (work merged in from elsewhere belongs to the change) |
| `version` | `show`, `next --change <major\|minor\|bugfix>` |
| `ideas` | `create --input`, `list`, `show --id` |
| `change` | `create --id --input` (`{title, change?, fromIdea?, description?}` – the user's description goes word for word into Goal), `show [--id]`, `list`, `set-status --to [--id] [--input]`, `set-kind --kind [--id]` |
| `git` | `branch-new --input [--mode abort\|stash\|carry]`, `branch-chore --input`, `commit-docs --input`, `commit-plan --input`, `commit-do --token --input` |
| `plan` | `init [--id]`, `check [--id]` (the `## Steps` checklist) |
| `steps` | `list`, `next`, `tick --step <n>`, `add --input` (`{text}`) |
| `history` | `init`, `add --input` (`{step?, change, files?, notes?}` → one dated row) |
| `knowledge` | `init --name <build-test\|project\|requirements\|architecture\|stack\|ui\|adoption-plan\|release>` (`.buggy/<name>.md` from the template, never overwritten) |
| `review` | `round-start --type incremental\|final`, `finding-add --input`, `finding-update --finding R<N>.<k> --input`, `round-end`, `status` |
| `ship` | `sync-plan`, `sync-do --token`, `sync-continue-plan`, `sync-continue-do --token`, `prepare --input`, `verify` |
| `githooks` | `check` (only files named like git hooks count as active hooks), `install --mode fresh\|append`, `tag-now` |
| `doctor` | `check` (read-only: `{ok, errors, warnings, infos, findings[]}`), `context` (files for `full`: `{knowledge, manifests, claude, releases[]}` – the 3 newest releases by SemVer); `check` reports `claude-block-outdated` when the `CLAUDE.md` block differs from the one this plugin version writes, and `version-hardcoded` when the root `mix.exs` (`def project`) or `pyproject.toml` holds its own literal version |
| `release` | `target [--version X.Y.Z\|latest]` (`latest` = newest `vX.Y.Z` tag reachable from the main branch; `worktreeNeeded` when `HEAD` ≠ the tag's commit or the tree is dirty), `worktree-add --version`, `worktree-remove --version` (only buggy's own worktree in `.buggy/.tmp/release-vX.Y.Z`) |
| `setup` | `detect`, `branch [--main]`, `init --input`, `claude-block`, `move --input`, `stub --input` – works before `.buggy/config.yaml` exists |
| `guard` | PreToolUse hook: allow own calls, deny `git push` and `git commit` on the main branch (stdin: hook event) |
| `session-start` | SessionStart hook: plain-text context in buggy projects |

## Project git hooks

`.githooks/buggy-tag.sh` is generated from `githooks/buggy-tag.sh.tpl` with the
config values written in (main branch, version file, JSON key – the line
`# buggy:config …` lets `doctor` compare them with `.buggy/config.yaml`). It is
plain POSIX sh, so it works in every clone without Node. `post-merge` and
`post-commit` call it (`githooks/hook.tpl`). Rules: only on the main branch; no tag
for `0.0.0`; a missing `vX.Y.Z` is created as an annotated tag with the release note
title; a tag on an ancestor is left alone (e.g. merging a `chore/` branch); a tag
outside the main branch's history is reported, never moved; `buggy-init` once.
Never pushes. `core.hooksPath` is local to a clone – `doctor` checks it.

Install modes: `fresh` writes `.githooks/post-*` and sets `core.hooksPath=.githooks`
(refused when other hooks are active or `core.hooksPath` points elsewhere);
`append` adds one call line to the hooks in the current hooks directory.
Hook managers (husky, lefthook, pre-commit) are reported; their configuration is
changed by the user.

## Agents

`agents/code-reviewer.md` and `agents/security-reviewer.md` (called from
`/buggy:review`) and `agents/consistency-reviewer.md` (called from
`/buggy:doctor full`) – read-only (`tools: Read, Grep, Glob`), `model: opus`, called
with the Agent tool as `subagent_type: "buggy:<name>"`. They receive only paths
(diff, spec, plan; or the `doctor context` lists) and answer with a JSON array of
findings (`severity`, `location`, `finding`, `evidence`, `suggestion`; the
consistency reviewer adds `area`: `requirements | stack | documents`). The session
verifies every finding before showing it. Claude Code ignores `permissionMode`, `hooks` and
`mcpServers` in plugin agents; the plugin's PreToolUse hook applies to them too.

## Release (`/buggy:release`, D-13)

The project's procedure is `.buggy/release.md` (template: Overview, Prerequisites,
Steps, Verification, Rollback, Notes), written with the user and committed only after
their confirmation. Every step that acts outside the machine is marked **[outside]**:
the user runs it, or Claude after a yes for that exact command; secrets are always
typed by the user. A version other than the checked-out one is built in a temporary
detached worktree on its tag (`.buggy/.tmp/release-vX.Y.Z`, ignored by git), removed at
the end. v1 keeps no publication log – the tag, the release note and the procedure are
the trace. Artifacts built in that worktree are copied to the place the procedure names
before the worktree is removed. A release never changes code: what it reveals (failing
checks, advisories, dependency updates) goes to `/buggy:new-idea` or `/buggy:new`.

## Review rounds (D-26)

`review.md` gets one `## Round N` section per round (written by `review.mjs`).
Round 1 and every `final` round review the diff from the merge-base with the main
branch; an `incremental` round reviews the diff since the previous round's
checkpoint (the `HEAD` at `round-end`). The diff always reaches the working tree
(uncommitted and new files included) and leaves out the change's own documents.
The `approved` gate: the last round is `final`, finished and led to no fix; every
finding has a decision; every `fix` is `done`. After every round the round's
documents are committed (`commit-docs` of `changes/<id>/`); a final round commits
them with the approval.

## Hooks

| Hook | Matcher | Does |
|---|---|---|
| SessionStart | – | `hooks/session-start.sh`: silent outside buggy projects (no Node started); otherwise version, branch, current change, next command and the core rules (the plugin's own CLAUDE.md is not loaded by Claude Code). |
| PreToolUse | `Bash\|Write` | `hooks/guard.sh`: passes only events that mention `git`, `run.sh` or `.buggy/.tmp/` to Node. **deny** `git push`, `git commit` on the main branch; **allow** buggy's own calls; otherwise no opinion. Fails open. Protection against model mistakes, not a security boundary. |

Manual test protocol: [`manual-tests.md`](manual-tests.md).

## YAML subset

`.buggy/config.yaml` and Markdown frontmatter use a strict subset of YAML:
`key: value` scalars (plain or quoted strings, integers, `true`/`false`,
`null`/`~`), nested maps with 2-space indentation, lists of scalars (`- item`,
`[]`, `[a, b]`) and `#` comments. Anything else is an error, never a guess.
Only plain integers become numbers: `0.6.4` and `2026-11-19` stay strings.

## Change lifecycle

`spec.md` frontmatter is the single source of a change's state:

```
draft → clarified → planned → implementing → implemented → in-review → approved → shipped
                ↺ (spec edited after clarify → clarify again)        any status before shipped → abandoned
```

Allowed transitions: `TRANSITIONS` in `scripts/lib/change.mjs`. Gates enforced by
the script: `planned` needs `plan.md` with a valid `## Steps` checklist (S1..Sn,
no gaps, every step has text) and an unchanged spec; `implemented` needs every
step checked; `approved` needs the review gate above.

## Project permissions

Test and build commands from `.buggy/build-test.md` run through the user's normal
permissions. `/buggy:plan` may offer an `allow` rule in `.claude/settings.json`
(only with an explicit yes). Note: Claude Code ignores a project's `allow` rules
until the user has accepted the workspace trust dialog – a cloned repository
cannot grant itself permissions.

## Tests

Every test runs in a fresh temporary git repository with an isolated git
configuration (`tests/helpers.mjs`). The harness refuses to run when the
temporary directory is inside a git repository. Scripts are executed through
`run.sh`, exactly as skills run them.

## Project setup (`/buggy:start`)

One skill for the three cases (new project, existing project without SDD,
existing SDD practice). `setup detect` proposes the case from evidence; the user
confirms. The setup runs on `chore/<date>-buggy-setup` (a repository without
commits: the user makes the first commit on the main branch). `setup init` writes
the config as early as possible – until then the guard hook cannot pre-approve
buggy's commands. Adoption of an existing practice: `.buggy/adoption-plan.md`
(variants, mapping) first, then three commits through the preview: pure
`git mv` (history kept) → stubs in the old places of moved living documents →
new files, ideas, `CLAUDE.md` block (`setup claude-block`, between
`<!-- buggy:begin -->`/`<!-- buggy:end -->`), hooks. `setup move` refuses idea
names that buggy would not recognise (`ideas/YYYYMMDD-name.md`).

## Documents and languages (D-19)

A command and its arguments (`latest`, `final`, a version) do not show the user's
language – then `language.docs` applies; the language of the files buggy writes never
changes the language of the conversation. Everything buggy writes for itself (`.buggy/`, scripts' output, templates' headings,
commit messages by default) is English. What the user writes with buggy – `spec.md`
(title included, never translated), clarifications, `plan.md`, `history.md`,
`review.md`, ideas, release notes – follows `language.docs`; template headings stay.
`clarify` and `plan` accept answers written into the file (notes, `<!-- comments -->`):
they re-read the file before recording and never overwrite the user's edits. A
contract test checks that every skill writing change documents names `language.docs`.

