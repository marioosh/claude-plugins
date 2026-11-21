---
name: release
description: Publish a released version (default the latest) following the project's procedure in .buggy/release.md; create or update that procedure with the user.
argument-hint: "[X.Y.Z|latest|update]"
disable-model-invocation: true
effort: high
allowed-tools: Bash(sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh *), Edit(/.buggy/.tmp/**)
---

# buggy: release

Project state:

!`sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh state`

Arguments from the user: $ARGUMENTS

## Rules

- Talk to the user in the language they use (when they have not written anything yet – a command and its arguments such as `latest`, `final` or a version do not count – use `language.docs` from the state). The language of the files you write (e.g. English in `.buggy/`) never changes the language you talk in. `.buggy/release.md` is written in English.
- Pass text to scripts **only through a JSON file** written with the Write tool in `.buggy/.tmp/` (new file name every time). Run scripts only as `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh <script> …`; on `"status":"error"` explain the `message` and stop.
- **One script per Bash call**, exactly in that form: no variables, no `&&`, `;` or pipes, nothing else in the same command.
- **Anything that acts outside this machine** – publishing, deploying, uploading, pushing, logging in to a registry or server – is run by the user, or by you only after an explicit yes for **that exact command**. Never type passwords, tokens or other secrets; the user enters them. Never change versions or tags, never commit to the main branch, never push.
- A release publishes a version that was already shipped (`vX.Y.Z` tag). It does not create versions – that is `/buggy:ship`.
- **A release never changes code.** Problems it reveals (failing checks, security advisories, bugs, dependency updates) are reported and handed over: offer `/buggy:new-idea`, or `/buggy:new` for a fix that becomes a new version – never fix them inside `/buggy:release`.

## Steps

1. Node/buggy errors → explain and stop.
2. **Procedure.** If `.buggy/release.md` does not exist, or the argument is `update`:
   - `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh knowledge init --name release`;
   - look at the project for how it is published (CI configuration, Dockerfile, deployment configuration, publish scripts in the manifests, README) and ask the user: what is published and where, prerequisites, the exact steps, how to verify, how to roll back;
   - propose the procedure – numbered steps, one command each, `<version>` for X.Y.Z, every step that acts outside this machine marked **[outside]**, and where the built files (artifacts) end up: a build may run in a temporary worktree that is removed at the end, so the procedure copies them to a lasting place (e.g. the main working tree's output folder) – and write it only after the user confirms;
   - commit it with `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git commit-docs --input <file>` when the current branch is not the main branch; on the main branch offer to create a short branch first: `{"title": "release procedure"}` → `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git branch-chore --input <file>`, or leave it uncommitted and tell the user.
   - With the argument `update`, stop here.
3. **Version.** `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh release target --version <X.Y.Z or latest>` (no argument → `latest`). Show the version, the tag and the release note (read `releaseNote`). If `onMain` is false, warn that this tag is not on the main branch and ask before continuing.
4. **Code of that version.** If `worktreeNeeded` is true (the checkout is not exactly that tag, or it has uncommitted changes), explain it and – after a yes – run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh release worktree-add --version <version>`. Every local step then runs in that directory (`worktree`), never in the user's working tree.
5. **Steps of the procedure**, in order. Show each step before it runs:
   - local steps (build, test, package) – run them (the user's normal permissions apply);
   - **[outside]** steps – show the exact command and ask: will the user run it, or should you run it now? Run it only after a yes for that command; when it needs a secret, the user runs it. A command the user runs gets absolute paths (inside a worktree, its full path), so it works from any directory.
   Stop on the first failure and ask how to continue (the procedure's Rollback section may apply).
6. **Verification** as the procedure describes; report what was published where and how it was verified.
7. If a worktree was created: first make sure no artifact the user still needs is left only inside it (built files not yet copied out, e.g. for an **[outside]** step the user runs later) – copy them to the place the procedure names, or ask; then `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh release worktree-remove --version <version>`.
8. Delete the temporary files you wrote in `.buggy/.tmp/` (e.g. build logs) when the release succeeded; after a failure keep them and tell the user where they are.
9. If the procedure was wrong or incomplete, offer `/buggy:release update`.
