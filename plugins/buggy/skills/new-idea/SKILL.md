---
name: new-idea
description: Save an idea for later as a file in ideas/ (one file per idea), without starting work on it.
argument-hint: "<idea>"
disable-model-invocation: true
allowed-tools: Bash(sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh *), Edit(/.buggy/.tmp/**)
---

# buggy: new idea

Project state:

!`sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh state`

The idea from the user: $ARGUMENTS

## Rules

- Talk to the user in the language they use (when they have not written anything yet – a command and its arguments such as `latest`, `final` or a version do not count – use `language.docs` from the state). The language of the files you write (e.g. English in `.buggy/`) never changes the language you talk in. Write the idea in the project's documents language (`language.docs` in the state), unless the user wrote it in another language – then keep their words.
- Pass text to scripts **only through a JSON file** written with the Write tool in `.buggy/.tmp/`, using a **new file name every time** (e.g. `.buggy/.tmp/idea-<4 random letters>.json`). Never put the user's text into a command line.
- Run scripts only as `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh <script> …`. Every script prints JSON; on `"status":"error"` explain the `message` to the user and stop.
- **One script per Bash call**, exactly in that form: no variables, no `&&`, `;` or pipes, nothing else in the same command (anything else is not pre-approved and asks the user).
- Do not invent content. Save what the user said.

## Steps

1. If the state has `status: error` with code `node-missing`/`node-too-old`: say buggy needs Node.js ≥ 20 (https://nodejs.org) and stop. If `buggy` is `false`: say buggy is not set up here and suggest `/buggy:start`; stop.
2. If the idea text is empty, ask the user for it and wait.
3. Prepare `title` (a short name, at most ~8 words, from the user's text) and `description` (the user's full text).
4. If the current `branch` equals `mainBranch`: buggy never commits there. Ask the user to choose:
   - **a)** create a short branch `chore/<date>-idea-<name>` and commit the idea there (they merge it later), or
   - **b)** save the file and leave it uncommitted.
   For **a)**: write `{"title": "idea <title>"}` to a new input file and run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git branch-chore --input <file>`.
5. Write `{"title": …, "description": …}` to a new input file and run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh ideas create --input <file>`.
6. Unless the user chose **b)**: write `{"message": "docs(ideas): add <id>", "paths": ["<path>"]}` (`id` and `path` from step 5) to a new input file and run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git commit-docs --input <file>`.
7. Tell the user the idea's id and file, and that `/buggy:new` (without a description) lets them start work on it later.
