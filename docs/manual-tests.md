# Manual tests (Claude Code)

Skills are not deterministic, so besides `npm test` every stage is checked by
hand in a real Claude Code session. Use a scratch repository, never a real project.

## Setup

```bash
mkdir /tmp/buggy-e2e && cd /tmp/buggy-e2e
git init -q -b main
mkdir .buggy && printf 'buggy: 1\nlanguage:\n  docs: pl\n' > .buggy/config.yaml
echo 0.6.4 > version.txt && echo '# App' > README.md
git add . && git commit -qm setup && git tag v0.6.4
claude --plugin-dir /path/to/mario_buggy_plugin/plugins/buggy
```

Headless variant (one turn per command, `--continue` for the next turn):

```bash
claude -p "/buggy:version" --plugin-dir /path/to/plugins/buggy
claude -p "a" --continue --plugin-dir /path/to/plugins/buggy
```

Add `--output-format stream-json --verbose` to see tool calls and
`permission_denials` (they must be empty for buggy's own commands).

## Stage 2 protocol (all passed on 2026-11-19, Claude Code 2.1.311)

| # | Steps | Expected |
|---|---|---|
| 1 | `/buggy:new-idea <text>` on `main` | Question: a) `chore/…` branch, b) leave uncommitted. No permission prompt. |
| 2 | Answer `a` | Branch `chore/<date>-idea-…`, idea file committed, clean tree, **no permission prompt in the second turn** (guard hook, D-42). |
| 3 | `/buggy:new` (no description) | Numbered list of ideas (with branch), question. |
| 4 | Answer `1` | Branch `feature/<date>-<slug>` **from main**, `changes/<id>/spec.md` with an `## Idea` section, commit `docs: start change …`; warning when the idea lives only on another branch. |
| 5 | Edit the spec by hand, commit | – |
| 6 | `/buggy:clarify` | Thorough analysis in the first answer, numbered questions grouped by topic with proposed answers. |
| 7 | Answer the questions | Spec updated (Clarifications table, requirements, acceptance criteria); frontmatter untouched. Edits of `spec.md` go through the user's normal permissions. Question "is the specification clarified?". |
| 8 | Answer `tak` / `yes` | `status: clarified`, `spec_hash` set, commit `docs: clarify …`, next: `/buggy:plan`. |
| 9 | `/buggy:version` | Version + tag, current change (status, would-be version, next command), changes in progress, ideas (with `startedAs`). |
| 10 | Uncommitted file, `/buggy:new bugfix "…"` | List of files, choice abort / stash / carry; after `stash`: new branch from main, stash with description, restore command shown. |
| 11 | Ask Claude to run `git push` | Blocked by the guard hook with the buggy message. |
| 12 | Ask Claude to `git commit` on `main` | Blocked by the guard hook. |
| 13 | New session in the project | SessionStart context: version, branch, current change, rules. Silent in a non-buggy repository. |

## Stage 3 protocol (all passed on 2026-11-19, Claude Code 2.1.311)

Test project: a small Node library (`package.json` with `"test": "node --test test/"`,
`src/math.js`, `test/math.test.js`), version in `package.json` (`version.file: package.json`),
a change "sum function" prepared up to `clarified` with the scripts.

> **Headless gotchas.** `--continue` resumes the *most recent* session in the folder –
> any other `claude -p` run in between hijacks it; use `--resume <session id>`.
> Project `allow` rules in `.claude/settings.json` are **ignored until the workspace
> is trusted** (interactive trust dialog); simulate the user's consent with
> `--allowedTools "Bash(npm test:*)"` instead of changing the trust settings.
> `--permission-mode acceptEdits` stands for the user approving code edits.

| # | Steps | Expected |
|---|---|---|
| 1 | `/buggy:plan` | `plan.md` created and filled in the first answer (Decisions marked "to confirm", small Steps), `.buggy/build-test.md` created from the template, test commands **proposed, not written** until confirmed. No code changed. |
| 2 | Accept the decisions, the commands and the **whole** plan | Commands written to `build-test.md`; `plan check` OK; status `planned`; commit `docs: plan …` with `plan.md`, `spec.md`, `build-test.md`. |
| 3 | `/buggy:implement` | Question: commit after every step (a) or at the end (b). |
| 4 | Answer `a` | `implementing` + `history.md` + docs commit; S1: code and tests, tests run, `steps tick`, `history add`, commit **preview** (code + `plan.md` + `history.md`), question. |
| 5 | Answer `tak` | Commit of S1 through the token; S2 done the same way, preview, question. |
| 6 | **New session** (do not answer), `/buggy:implement` | Resumes: recognises S1 committed, S2 ticked but uncommitted; asks for the strategy. |
| 7 | `a`, then `tak`, then `tak` | S2 committed; full test suite; "Final test results" filled; status `implemented`; final commit preview → commit; next: `/buggy:review`. |
| 8 | `/buggy:version` / new session | Plan progress `2/2`, status `implemented`, next `/buggy:review`. |

## Stage 4 protocol (all passed on 2026-11-19, Claude Code 2.1.311)

Test project: the stage 3 project with the change in status `implemented`, plus a
planted problem committed after implementation (`export function average(numbers) {
return sum(numbers) / numbers.length; }` – not in the spec or plan, no test,
`average([])` is `NaN`; the test suite still passes).

| # | Steps | Expected |
|---|---|---|
| 1 | `/buggy:review` | `round-start` (round 1, diff from the merge-base), **two reviewers in parallel** (`buggy:code-reviewer`, `buggy:security-reviewer`) with paths only; findings verified in the code before they are shown; findings recorded (`R1.1`, …); proposed decision per finding; question. The planted `average` is found. |
| 2 | Decide: one `fix`, one `defer` | Fix applied, tests run, history row `R1.1`; deferred finding becomes an idea in `ideas/`; decisions and statuses updated; commit preview (code + `review.md` + `history.md` + idea). |
| 3 | `tak` | Commit through the token; `round-end` → checkpoint = that commit. |
| 4 | **New session**, `/buggy:review final` | Round 2 `final` (full diff again), reviewers, no new findings; acceptance criteria table in `review.md`; `review status` → `approval.ok`; question "do you approve?" – the Approval section stays empty until the answer. |
| 5 | `Tak, zatwierdzam.` | Approval section filled, status `approved`, docs commit; next: `/buggy:ship`. |
| 6 | Reviewer independence | The reviewer prompts contain only `Diff: … Specification: … Plan: … Round: …`. |

## Stage 5 protocol (all passed on 2026-11-19, Claude Code 2.1.311)

Test project: the stage 4 project with the change `approved`, no git hooks installed.

| # | Steps | Expected |
|---|---|---|
| 1 | `/buggy:ship` on the change branch | `githooks check` (not installed) → proposal `--mode fresh`; `ship sync-plan` (up to date); `version next` (0.1.0 → 0.2.0); release note draft shown as JSON; two questions. |
| 2 | Accept hooks and note | `githooks install --mode fresh` (`core.hooksPath=.githooks`), commit preview of `.githooks/`. |
| 3 | `tak` | Hooks committed; `ship prepare` (version file, `shipped`, `releases/0.2.0-<slug>/` with `release-note.md`); release commit preview. |
| 4 | `tak` | Release committed on the change branch (no tag there); merge commands for the user; reminder about other clones. |
| 5 | As the user: `git switch main`, `git merge --no-ff --no-edit feature/<id>` | The hook prints `created tag v0.2.0` and `created tag buggy-init`; the tag message is the release note title. |
| 6 | `/buggy:ship` on `main` | `ship verify` OK: version, tag on main, release folder. |
| 7 | `/buggy:doctor` | Healthy: no findings. |
| 8 | Break: `git config --unset core.hooksPath`, `git tag -d v0.2.0`, a leftover in `.buggy/.tmp` → `/buggy:doctor` | Report grouped by level (hooks, untagged main/release, leftover) with fixes; question. |
| 9 | `Wszystkie.` | Hooks reinstalled (files already committed → only `core.hooksPath`), `githooks tag-now` recreates `v0.2.0`, leftover removed after checking it; `doctor check` again → healthy. Nothing pushed. |

## Stage 6 protocol (all passed on 2026-11-20, Claude Code 2.1.311)

Before `.buggy/config.yaml` exists the guard hook cannot pre-approve buggy's own
commands; headless tests simulate the user's "allow" with
`--allowedTools "Bash(sh <plugin>/scripts/run.sh *)" "Edit(/.buggy/.tmp/**)" "Bash(git init:*)"`.

| # | Case | Steps | Expected |
|---|---|---|---|
| 1 | 1.1 | Empty folder with `brief.md`, `/buggy:start brief.md` | `setup detect` → case 1.1, questions (case, documents language, main branch, version, `git init`). |
| 2 | 1.1 | Answers | `git init -b main`, `setup init` (`version.txt` 0.0.0), knowledge files from the brief (English), open questions, proposed test commands. |
| 3 | 1.1 | Confirm | `build-test.md`, `CLAUDE.md` block, hooks (fresh); first-commit commands for the user. |
| 4 | 1.1 | As the user: `git add -A`, `git commit` on main | Hook: `buggy-init`; `doctor` clean. |
| 5 | 1.2 | Node project with `origin`, `/buggy:start` | Security note (origin) with tool links; case 1.2; version from `package.json` matching the tag. |
| 6 | 1.2 | Answers, confirmations | `chore/<date>-buggy-setup`, config, knowledge from the code (gaps as questions), commands checked, block, hooks, commit preview → commit; merge commands. |
| 7 | 1.2 | As the user: merge | `buggy-init`; `v1.3.0` kept; `doctor` clean. |
| 8 | 1.3 | Clone of Darters.Zone, `/buggy:start` | Security note (origin, `allow` rules, `.mcp.json`); case 1.3 with all SDD markers; version 0.6.4 from `version.txt` (read by `mix.exs`). |
| 9 | 1.3 | Answers | Branch, config, `.buggy/adoption-plan.md` with variants A/B, mapping, Claude configuration and hooks, questions. |
| 10 | 1.3 | Choose A (and decisions) | Commit 1: 64 pure `git mv` (living docs → `.buggy/`, research → `archive/research/`, history and old process → `archive/`, future specs → `ideas/YYYYMMDD-…`); preview → yes. |
| 11 | 1.3 | `tak` | Commit 2: stubs in the old places of moved living documents. |
| 12 | 1.3 | Confirm commands, `CLAUDE.md` changes | Commit 3: new knowledge files, 25 ideas from the roadmap, `CLAUDE.md`/`AGENTS.md` without the old process + buggy block, hooks (old `post-commit` archived, fresh install), language exceptions, fixed references. |
| 13 | 1.3 | As the user: merge | `buggy-init`; `v0.6.4` kept; 30 ideas; `doctor` clean; `git log --follow .buggy/requirements.md` reaches the history of `docs/FUNCTIONAL_SPEC.md`. |

## Stage 7 protocol (all passed on 2026-11-20, Claude Code 2.1.311)

`mathlib` (stages 3–5, tags `v0.1.0`, `v0.2.0`) with a "registry" folder outside the
repository; headless runs add `--allowedTools "Bash(npm test:*)" "Bash(npm pack:*)"`.

| # | Case | Steps | Expected |
|---|---|---|---|
| 1 | release | `/buggy:release` without `.buggy/release.md` | `knowledge init --name release`, project scan, questions (what/where, steps, verify, rollback). |
| 2 | release | Answers, confirm | Procedure with `<version>` and **[outside]** marks; on main: `branch-chore` (`{"title": …}`) → `commit-docs`; `release target` → `v0.2.0`, `worktreeNeeded` (on the chore branch). |
| 3 | release | `tak` | `release worktree-add`; `npm test`, `npm pack` in `.buggy/.tmp/release-v0.2.0`; the **[outside]** copy shown with absolute paths and the question who runs it. |
| 4 | release | "Run it now" | Claude Code blocks the folder outside the session; the model does not work around it and gives the command to the user. |
| 5 | release | As the user: copy, paste `ls` + `shasum` | Checksums compared; `release worktree-remove`; report; suggestions for `/buggy:release update`. |
| 6 | release | Merge the procedure branch, `/buggy:release 0.1.0` | `target` 0.1.0 (no release note), worktree on `v0.1.0`; tests of the old code (1 test), package `mathlib-0.1.0.tgz`; the user copies; verification; worktree removed; working tree on `main` untouched. |
| 7 | doctor full | Darters.Zone clone after adoption (stage 6), `.buggy/stack.md` "Phoenix 1.7" vs `mix.exs` `~> 1.8.16`, `/buggy:doctor full` | `doctor context` → `buggy:consistency-reviewer` with paths only → findings verified; the planted contradiction is error 1 (with LiveView 1.2 and `stack.md:72` "Phoenix 1.8"); other real findings from the adoption (Leaflet vs MapLibre, stale references, `.gitkeep`), 0 false positives; fixes grouped (documents / files through the preview / code → `/buggy:new-idea`). |
| 8 | doctor full | "Only point 1, on a short chore branch" | `branch-chore` → edit `.buggy/stack.md` → `commit-docs`; `doctor check` clean; nothing pushed or merged. |

## Stage 8 – Definition of Done (passed on 2026-11-21, Claude Code 2.1.311)

Real use, not the test harness: the user drove every command in interactive Claude
Code sessions in a copy of Darters.Zone (Elixir/Phoenix/Ash, released up to 0.6.4,
its own spec-driven practice; no git remote). The plugin was installed from the
local marketplace: `claude plugin marketplace add <repo> --scope local`,
`claude plugin install buggy@nosinski --scope local` – a `directory` marketplace is
read in place, so fixes reached the next session without reinstalling.

| # | Step | What happened | Result |
|---|---|---|---|
| 1 | `/buggy:version` before setup | Aborted: an injected command exited 1 (problem 1) | Fixed; suggests `/buggy:start` |
| 2 | `/buggy:start` | Case 1.3, variant A: 62 pure `git mv`, 5 stubs, knowledge, 30 ideas, `CLAUDE.md`/`AGENTS.md` without the old process, hooks (old `post-commit` archived) | `doctor` clean; hook problem 2 and missing `/buggy:release` in the block (3) fixed; `/buggy:doctor` refreshed the block on the setup branch |
| 3 | Merge (user) | `buggy-init` tag, `v0.6.4` kept | `git log --follow` of moved documents reaches the first commit |
| 4 | `/buggy:doctor full` | 14 findings, all confirmed, 0 false positives; hosting decided by the user; fixes on a chore branch (`commit-docs` + preview for `AGENTS.md`) | Merged; stale references in code not in scope of the reviewer (observation 4 → idea after 1.0) |
| 5 | `/buggy:new bugfix …` | First try lost the description and translated the title (problems 5, 6); branch deleted by the user, second try correct | Title in Polish, description in Goal, `bugfix` |
| 6 | `/buggy:clarify` ×2 | 14 questions with proposals; scope extended once, the plan's spec gate sent it back to clarify | R1–R8, AC1–AC3, Out of scope |
| 7 | `/buggy:plan` | 6 steps, decisions D1–D7, accepted as a whole | `plan check` ok |
| 8 | `/buggy:implement` | ~55 files, `mix compile` per step, `mix precommit` (491 tests, credo, sobelow) green; code commit through the preview | `history.md` was English (problem 8, fixed) |
| 9 | `/buggy:review`, `/buggy:review final` | Two reviewers, 0 findings in both rounds; acceptance table; approval | Round documents left uncommitted after a round without fixes (problem 9, fixed) |
| 10 | `/buggy:ship` + merge (user) | `version.txt` 0.6.5, `releases/0.6.5-…/` with a Polish release note, hook tag `v0.6.5` on the merge | `doctor` clean, nothing in progress |

Problems found in real use: 9 – eight fixed with tests during the stage, one
(observation 4) deferred. `/buggy:release` was not repeated: the project has no
deployment yet (D-52); it was tested in stage 7.

## Stage 9 – case 1.2 in a real project (passed on 2026-11-21, Claude Code 2.1.311)

A real Elixir umbrella project (Phoenix, Ash, SQLite, Burrito binaries for friends),
one commit, no remote, no tags, version hard-coded in the root `mix.exs`. The user
drove every command; the plugin was installed from the local marketplace.

| # | Step | What happened | Result |
|---|---|---|---|
| 1 | `/buggy:start` | `detect` proposed 1.3 (`features/` notes); the user chose 1.2: knowledge from the code, existing plans and research left in place and referenced | `buggy-init`, `v0.1.1`; `version.txt` added but `mix.exs` kept its own version (problem 10) |
| 2 | `/buggy:doctor` | New `version-hardcoded` → chore branch: root and app `mix.exs` read `version.txt` via `__DIR__` | `doctor` clean |
| 3 | `/buggy:doctor full` | 2 infos (a requirement without a test, undocumented dependencies), 0 false positives | `stack.md` completed on a chore branch |
| 4 | `/buggy:release` | Procedure written with the user (build in a worktree, artifacts copied to `dist/<version>/`, SHA256SUMS, smoke test, **[outside]** hand-over); `v0.1.1` built for macOS, Linux, Windows | Artifacts kept (problem 11 fixed before the run); the session offered to fix advisories itself and talked English (problems 12, 13) |
| 5 | Dependency updates | Done outside the cycle on a chore branch (problem 12) → brought into `/buggy:new bugfix` by merging that branch into the change branch | `clarify` first called the change done (problem 14) → `change.branchWork` |
| 6 | `plan → implement → review → ship → release` | Verification steps for the merged work, `hex.audit` added to `build-test.md`, two review rounds, `0.1.2` with tag, binaries in `dist/0.1.2/` | `doctor`: only build logs left in `.buggy/.tmp` (problem 15) |

Problems found: 10–15, all fixed with tests during the stage.

