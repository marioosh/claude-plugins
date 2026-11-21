---
name: start
description: Set up buggy in this project - a new project, an existing project without spec-driven development, or the adoption of an existing spec-driven practice.
argument-hint: "[path to a file that describes the project]"
disable-model-invocation: true
effort: high
allowed-tools: Bash(sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh *), Edit(/.buggy/.tmp/**)
---

# buggy: start

What is in this folder:

!`sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh setup detect`

Arguments from the user: $ARGUMENTS

## Rules

- Talk to the user in the language they use (when they have not written anything yet – a command and its arguments do not count – use the language of the project description they gave, or of the project's own documents). The language of the files you write never changes the language you talk in. Everything in `.buggy/`, the code and commit messages is in English (D-19) – except documents that are moved unchanged, which keep their language (record it in `language.exceptions` of `.buggy/config.yaml`). The **documents language** (`language.docs`) is only for what the user writes with buggy later: specifications, ideas, comments in them.
- Pass text to scripts **only through a JSON file** written with the Write tool in `.buggy/.tmp/` (new file name every time). Run scripts only as `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh <script> …`; on `"status":"error"` explain the `message` and stop.
- **One script per Bash call**, exactly in that form: no variables, no `&&`, `;` or pipes, nothing else in the same command. Until `.buggy/config.yaml` exists the user may be asked to approve buggy's own commands – that is expected; write the config as early as possible (step 5).
- **The user decides.** Confirm the case before anything is created; show every knowledge file before it is committed; move or archive nothing before the user has chosen a variant; never commit to the main branch, never push; commits through the preview: `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git commit-plan --input <file>` → show → yes → `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git commit-do --token <token> --input <new file, same content>`.
- Write knowledge only from what the user said, a file they gave, or what you found in the project – mark guesses as questions.

## Steps

1. Node errors → buggy needs Node.js ≥ 20 (https://nodejs.org); stop. `proposedCase` = `existing` → buggy is already set up: suggest `/buggy:version` and `/buggy:doctor`; stop.
2. **Security** (only when `origin` is set): say briefly that buggy protects against common mistakes but not against every scenario in a malicious repository, so the user should trust this repository or review it first – e.g. `find . -type l` (symlinks), OpenSSF Scorecard (https://github.com/ossf/scorecard), OSV-Scanner (https://github.com/google/osv-scanner), gitleaks (https://github.com/gitleaks/gitleaks), and Claude Code's security guide (https://code.claude.com/docs/en/security). If `claude.allowRules` > 0, ask them to look at the `allow` rules in `.claude/settings.json` (and `.mcp.json`, if present).
3. **Case.** Show `proposedCase` with its evidence (files, code files, manifests, `sddMarkers`, version candidates, Claude files) – 1.1 new project, 1.2 existing project without SDD, 1.3 existing SDD practice – and ask the user to confirm it. Ask together: the documents language for specifications and ideas (default: the language of this conversation; `.buggy/` stays English), the main branch (`mainCandidates`, default `main`), the version (an existing version file stays; otherwise the newest tag; a version hard-coded in `mix.exs`/`pyproject.toml` → propose `version.txt` **and making the manifest read it** (`mix.exs`: `version: __DIR__ |> Path.join("version.txt") |> File.read!() |> String.trim()` – `__DIR__`, because Mix compiles umbrella apps from their own directory; `pyproject.toml`: a dynamic version from the file through its build backend) – otherwise `/buggy:ship` bumps only `version.txt` and the build keeps the old number; it is a code change: part of the setup commit through the preview, then run the build command; a new project starts at `0.0.0`).
4. **Git.** No git → after a yes run `git init -b main`. No commits (`hasCommits` false) → work on the main branch now; the user makes the first commit (step 10). Otherwise → `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh setup branch --main <main branch>` (on `dirty-tree`: the user commits or cleans up first).
5. **Config.** Write `{"mainBranch": …, "version": {"file": …, "key": …}, "language": {"docs": "<language code such as en or pl>"}, "initialVersion": …}` (omit what does not apply) and run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh setup init --input <file>`.
6. **Case 1.3 – adoption plan first.** Run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh knowledge init --name adoption-plan` and fill it: what was found; variant **A** (old process files unchanged to `archive/`, current state to `.buggy/` and `ideas/`) and variant **B** (every released version to `releases/X.Y.Z-<name>/`), plus other variants if the analysis justifies them; the **mapping table** for the proposed variant:
   - living documents (requirements, UI, stack, external requirements, project description…) → `.buggy/requirements.md`, `.buggy/ui.md`, `.buggy/stack.md`, `.buggy/external-requirements.md`, … – the whole file under one name, no splitting;
   - research and reference material → `archive/research/`;
   - history (old specs, plans, histories, release notes) and old process rules (strategy documents, workflow skills, conflicting git hooks) → `archive/`;
   - work not started yet (future specs, roadmap ideas) → `ideas/` (files via `git mv` to `ideas/YYYYMMDD-<name>.md` – today's date **without dashes**, a lower-case name with `-`, e.g. `ideas/20261120-events-and-registrations.md`; roadmap rows as new ideas with `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh ideas create --input <file>`; add `References` to research files they need);
   - what stays untouched (framework skills, `AGENTS.md`, project agents, settings) and which `CLAUDE.md` sections describe the old process and will be replaced by the buggy block.
   Show the plan; the user chooses or adjusts. Only then execute:
   1. `{"moves": [{"from": …, "to": …}, …]}` → `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh setup move --input <file>` → commit through the preview (`chore(buggy): move existing documents – no content changes`);
   2. `{"stubs": [{"path": <old path of a moved living document>, "target": <new path>}]}` → `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh setup stub --input <file>` → commit through the preview;
   3. continue with steps 7–9 (they belong to the third commit). Record language exceptions of moved documents in `.buggy/config.yaml`; set the plan's **Status** to `done – variant <X>`.
7. **Knowledge** – for every file that does not exist yet (`project`, `requirements`, `architecture`, `stack`; `ui` only with a user interface): `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh knowledge init --name <name>`, then fill it.
   - 1.1: from the file named in the arguments, or an interview in small groups of questions (vision and users; main features and constraints; stack, versions and how to set up the environment; architecture; how to build, test and run).
   - 1.2 / 1.3: scan the project with the Explore agent (purpose, users, features, architecture and directories, stack and versions, setup steps, build/test/lint/run commands from manifests, README and CI, user interface), then ask about the gaps.
   Then `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh knowledge init --name build-test` and propose the commands; write them after the user confirms (and offer an `allow` rule in `.claude/settings.json` only with an explicit yes). Show each file (or a short summary of it) to the user.
8. **CLAUDE.md:** remove the old process sections named in the adoption plan (with the user's yes), then `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh setup claude-block`.
9. **Git hooks:** `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh githooks check` → `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh githooks install --mode <fresh|append>` (fresh only when `hooksPath` is null or `.githooks` and no other hooks are active; with husky/lefthook/pre-commit show the line for their configuration).
10. **Commit.**
    - With commits: everything that is left through the preview (`chore: set up buggy`).
    - Without commits: ask the user to make the first commit on the main branch themselves – `git add -A`, then `git commit -m "chore: set up buggy"`; the git hook tags it (`buggy-init`).
11. **Merge** (when you worked on the setup branch) – the user runs, each on its own: `git switch <main branch>`, `git merge --no-ff --no-edit <setup branch>`; the hook creates `buggy-init` (and the version tag if it is missing); `git push --follow-tags` when they want. Then: `/buggy:version`, `/buggy:doctor`, and `/buggy:new` or `/buggy:new-idea`.
