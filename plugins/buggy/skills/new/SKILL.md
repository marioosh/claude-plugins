---
name: new
description: Start a new change - a branch from the main branch and a specification file (from a description or from a saved idea).
argument-hint: "[major|minor|bugfix] [\"<short description>\"]"
disable-model-invocation: true
allowed-tools: Bash(sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh *), Edit(/.buggy/.tmp/**)
---

# buggy: new change

Project state:

!`sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh state`

Arguments from the user: $ARGUMENTS

## Rules

- Talk to the user in the language they use (when they have not written anything yet – a command and its arguments such as `latest`, `final` or a version do not count – use `language.docs` from the state). The language of the files you write (e.g. English in `.buggy/`) never changes the language you talk in.
- Pass text to scripts **only through a JSON file** written with the Write tool in `.buggy/.tmp/`, using a **new file name every time** (e.g. `.buggy/.tmp/new-<4 random letters>.json`). Never put the user's text into a command line.
- Run scripts only as `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh <script> …`. Every script prints JSON; on `"status":"error"` explain the `message` and stop, unless a step below says what to do.
- **One script per Bash call**, exactly in that form: no variables, no `&&`, `;` or pipes, nothing else in the same command (anything else is not pre-approved and asks the user).
- The user decides. Never stash, carry or discard their uncommitted work without their explicit choice.
- Do not write the specification's content. That is the user's job; you only create the file with the title and, word for word, the user's short description (D-4).

## Steps

1. If the state has `status: error` with code `node-missing`/`node-too-old`: say buggy needs Node.js ≥ 20 (https://nodejs.org) and stop. If `buggy` is `false`: suggest `/buggy:start` and stop.
2. **Change kind:** if the first argument is `major`, `minor` or `bugfix`, use it and treat the rest as the description; otherwise the kind is `minor`. `major` only when the user wrote it.
3. **No description:** run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh ideas list` and show the ideas as a numbered list (title, id, and the branches they are on when not in the working tree). Mark ideas with `startedAs` as already started (the change id) – they normally should not be picked again. Ask the user to pick one or to give a description instead. With an idea, the title comes from the idea.
4. Write `{"title": "<short title>"}` to a new input file – the title in the language of the user's description (their words, shortened, never translated; with an idea, the idea's title) and run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git branch-new --input <file>`.
   - On error code `dirty-tree`: show `details.files` and ask the user to choose: **abort** (they commit or clean up first), **stash** (put the changes aside), or **carry** (the changes belong to the new change). For stash/carry run the same command again with `--mode stash` or `--mode carry` (new input file). For abort, stop.
5. Write `{"title": …, "change": <kind>}` – plus `"description": "<the user's description, word for word>"` when they gave one, or `"fromIdea": "<idea id>"` when an idea was picked – to a new input file and run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh change create --id <id from step 4> --input <file>`.
6. Write `{"message": "docs: start change <id>", "paths": ["changes/<id>/spec.md"]}` to a new input file and run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git commit-docs --input <file>`.
7. Report: the branch, the specification file, the change kind and the version it would get if shipped now (bump of `version.main`). If changes were stashed, show the `restore` command from step 4. If step 5 returned a `warning`, show it.
8. Next step for the user: describe the change in `changes/<id>/spec.md` (Goal, Requirements, Acceptance criteria…), then run `/buggy:clarify`.
