---
name: ship
description: Release the approved change as a new version - sync with the main branch, version number, release note, move to releases/, commit with consent, merge instructions; on the main branch, verify the release and its tag.
disable-model-invocation: true
effort: high
allowed-tools: Bash(sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh *), Edit(/.buggy/.tmp/**)
---

# buggy: ship

Project state:

!`sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh state`

Arguments from the user: $ARGUMENTS

## Rules

- Talk to the user in the language they use (when they have not written anything yet – a command and its arguments such as `latest`, `final` or a version do not count – use `language.docs` from the state). The language of the files you write (e.g. English in `.buggy/`) never changes the language you talk in. The release note follows `language.docs`; the commit message follows `language.commits`.
- Pass text to scripts **only through a JSON file** written with the Write tool in `.buggy/.tmp/` (new file name every time). Run scripts only as `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh <script> …`; on `"status":"error"` explain the `message` and stop.
- **One script per Bash call**, exactly in that form: no variables, no `&&`, `;` or pipes, nothing else in the same command (anything else is not pre-approved and asks the user).
- **The user decides.** Every merge and every commit goes through a preview (`…-plan` → show → explicit yes → `…-do --token <token>`). You never merge into the main branch, never tag by hand, never push – you tell the user the commands.

## A. On the main branch, or no current change: verify the last release

1. Run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh ship verify` and report: version, tag, release folder.
2. Problems:
   - tag missing → the hooks were off in this clone or the merge happened on a server without a local `git pull`. Run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh githooks check`; offer to install the hooks (part B, step 2) and/or to tag now with `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh githooks tag-now` – only after a yes;
   - anything else (tag on a commit outside the main branch, wrong release folder) → explain it and suggest `/buggy:doctor`; no automatic renumbering.
3. Remind the user to push the tag: `git push --follow-tags`. Stop.

## B. On a change branch: release the change

1. The change must be `approved`; otherwise say which command fits (`change.next`) and stop.
2. **Hooks.** Run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh githooks check`. If `installed` is false, explain that the hooks create the `vX.Y.Z` tag after the merge, and offer to install them:
   - `managers` not empty (husky, lefthook, pre-commit) → show the line to add to their configuration (`sh "$(git rev-parse --show-toplevel)/.githooks/buggy-tag.sh"` in post-merge and post-commit) and run only `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh githooks install --mode append` if the user wants the script itself;
   - otherwise `--mode fresh` when `hooksPath` is null and `otherActiveHooks` is empty, else `--mode append`.
   After a yes: `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh githooks install --mode <mode>`, then commit the new `.githooks/` files through the preview. Tell the user that every other clone needs `git config core.hooksPath .githooks` once (`/buggy:doctor` checks it).
3. **Sync with the main branch.** `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh ship sync-plan`. When `upToDate` is false: show `behind` and `files`, ask, then `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh ship sync-do --token <token>`.
   - `conflicts` → list them and ask: you resolve them (show each resolution) or the user does. Then `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh ship sync-continue-plan` → show → yes → `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh ship sync-continue-do --token <token>`.
   - After a merge, run the tests from `.buggy/build-test.md`; stop on failures.
4. **Version.** `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh version next --change <change kind>` → show `main` → `next`.
5. **Release note.** Read `spec.md`, `plan.md`, `history.md`, `review.md` of the change. Draft `{"summary": "<two or three sentences>", "changes": ["…"], "migration": ["…"], "limitations": ["…"]}` (empty lists are fine) and **show it to the user**; adjust until they agree. Then write it to a new input file and run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh ship prepare --input <file>`.
6. **Commit.** Write `{"message": "release: v<version> – <title>", "paths": <paths from prepare>}` → `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git commit-plan --input <file>` → show → yes → `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git commit-do --token <token> --input <new file, same content>`.
7. **Merge – done by the user.** Give the commands, each on its own:
   - `git switch <mainBranch>`
   - `git merge --no-ff --no-edit feature/<id>` (or open a pull request; after merging it on the server, `git pull` creates the tag locally)
   - `git push --follow-tags`
   Then: run `/buggy:ship` on the main branch to verify the release and its tag.
