---
name: doctor
description: Check the project's buggy setup and consistency (versions, tags, git hooks, changes, releases, ideas) and fix problems only with the user's consent.
argument-hint: "[full]"
disable-model-invocation: true
allowed-tools: Bash(sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh *), Edit(/.buggy/.tmp/**)
---

# buggy: doctor

Project state:

!`sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh state`

Checks:

!`sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh doctor check`

Arguments from the user: $ARGUMENTS

## Rules

- Talk to the user in the language they use (when they have not written anything yet – a command and its arguments such as `latest`, `final` or a version do not count – use `language.docs` from the state). The language of the files you write (e.g. English in `.buggy/`) never changes the language you talk in.
- Pass text to scripts **only through a JSON file** written with the Write tool in `.buggy/.tmp/` (new file name every time). Run scripts only as `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh <script> …`; on `"status":"error"` explain the `message` and stop.
- **One script per Bash call**, exactly in that form: no variables, no `&&`, `;` or pipes, nothing else in the same command (anything else is not pre-approved and asks the user).
- **Doctor never fixes anything on its own.** Every fix needs the user's explicit yes; commits of anything other than buggy documents go through the preview (`sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git commit-plan --input <file>` → yes → `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git commit-do --token <token> --input <new file, same content>`). Never move or delete tags, never push.

## Steps

0. Node errors → buggy needs Node.js ≥ 20 (https://nodejs.org); stop. If `git` is `false` or `buggy` is `false` in the state: buggy is not set up here – suggest `/buggy:start` and stop (the checks then show an error – do not mention it).
1. **Deep analysis** – only when the argument is `full` (it is slower and costs more; without `full` go to step 2):
   1. `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh doctor context` → the lists of files. Reading the specifications of released versions in `releases/` is allowed here because the user asked for `full`; still never read `archive/`.
   2. Start the Agent tool with `subagent_type` `buggy:consistency-reviewer`. The prompt is only the paths, one group per line:
      `Knowledge: <knowledge>. Manifests: <manifests>. Claude files: <claude>. Releases: <spec and releaseNote of each release>.`
   3. **Verify every finding** before showing it (with the Read, Grep and Glob tools, not shell commands): open both sides of the evidence (the document line and the code, manifest or lockfile) and check that the inconsistency is real. Drop false positives and merge duplicates; remember how many you dropped.
2. Report the quick checks grouped by level – **errors**, **warnings**, **info** – each with its message and the proposed `fix`. With `full`, add a section **Consistency** with the confirmed findings (severity, area, location, finding, evidence, suggestion) and the number of dropped false positives. If there is nothing at all, say the project is healthy and stop.
3. Ask which fixes to apply (all, some, none). Typical fixes, each only after a yes:
   - `gitignore-tmp`: add `.tmp/` to `.buggy/.gitignore`, then commit it with `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git commit-docs --input <file>` (`{"message": "chore: ignore buggy temporary files", "paths": [".buggy/.gitignore"]}`) – not on the main branch;
   - `hooks-not-installed`: `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh githooks check`, then `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh githooks install --mode <fresh|append>` (fresh only when `hooksPath` is null and no other hooks are active) and commit the `.githooks/` files through the preview; in another clone only `git config core.hooksPath .githooks` is missing – tell the user the command;
   - `version-hardcoded`: show the exact edit from `fix`; after a yes, on a short branch (`{"title": "version from version file"}` → `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git branch-chore --input <file>` when on the main branch) make the manifest read the version file, run the build command from `.buggy/build-test.md`, and commit through the preview;
   - `claude-block-outdated`: show the difference, then `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh setup claude-block` and commit `CLAUDE.md` through the preview (not on the main branch – offer a short branch first);
   - `main-untagged`, `buggy-init-missing`: on the main branch, `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh githooks tag-now`;
   - `change-stale`: ask whether to continue or abandon the change; to abandon, the user switches to its branch, then write `{"reason": "…"}` and run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh change set-status --to abandoned --input <file>` and commit the spec with `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git commit-docs --input <file>`;
   - consistency findings in documents (`.buggy/*.md`, `CLAUDE.md`, `AGENTS.md`): propose the exact edit, make it only after a yes; commit `.buggy/` files with `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git commit-docs --input <file>` (`{"message": "docs: …", "paths": […]}`) and other files through the preview – not on the main branch (on the main branch offer a short branch first: `{"title": "…"}` → `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git branch-chore --input <file>`). Findings that need a code change are not fixed here: offer `/buggy:new-idea` or `/buggy:new`;
   - everything else (tags in the wrong place, version mismatches, broken files): explain what is wrong and what the user can do; change files only with their yes, tags never.
4. After fixing, run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh doctor check` again and show what is left.
