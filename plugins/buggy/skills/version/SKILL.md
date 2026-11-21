---
name: version
description: Show the project's current version, changes in progress and saved ideas (read-only).
disable-model-invocation: true
allowed-tools: Bash(sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh *)
---

# buggy: version

Project state:

!`sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh state`

Saved ideas:

!`sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh ideas list`

Present this briefly, in the language the user uses in this conversation (when they have not written anything yet – a command and its arguments do not count – use `language.docs` from the state; the language of the files never changes the language you talk in):

- If the state has `status: error` with code `node-missing` or `node-too-old`: say that buggy needs Node.js 20 or newer (https://nodejs.org). Stop.
- If `git` is `false`: this folder is not a git repository; `/buggy:start` can set the project up. If `buggy` is `false`: buggy is not set up here yet; suggest `/buggy:start`. Stop (the saved ideas then show an error – do not mention it).
- **Version:** the released version (`version.main` on `mainBranch`) and whether it is tagged.
- **Current change** (if any): id, title, status, change kind, the version it would get if shipped now (`change.wouldBe`), plan progress (`change.progress`: done/total steps, when a plan exists), review progress (`change.review`: rounds and open findings, when a review exists), and the next command (`change.next`). Mention it when `change.mainMoved` is true (the main branch moved since the change started).
- **Changes in progress** (`changes`): one line each – id, status, kind.
- **Ideas** (`ideas`, the roadmap preview): the count and the titles; for ideas not in the working tree, the branch they are on; for ideas with `startedAs`, the change that already started from them. Mention that `/buggy:new` without a description starts work on one.
- Show every entry of `warnings`.

This command is read-only. Do not run any other command and do not change any file.
