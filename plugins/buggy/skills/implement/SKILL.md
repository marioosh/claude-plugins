---
name: implement
description: Implement the accepted plan of the current change step by step - code, tests, history - committing only with the user's consent.
argument-hint: "[change id]"
disable-model-invocation: true
effort: high
allowed-tools: Bash(sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh *), Edit(/.buggy/.tmp/**)
---

# buggy: implement

Project state:

!`sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh state`

Arguments from the user: $ARGUMENTS

## Rules

- Talk to the user in the language they use (when they have not written anything yet – a command and its arguments such as `latest`, `final` or a version do not count – use `language.docs` from the state). The language of the files you write (e.g. English in `.buggy/`) never changes the language you talk in. Code, identifiers, code comments and commit messages follow `language.code` / `language.commits` (English by default) and the project's own conventions (`CLAUDE.md`, `AGENTS.md`). Entries in `history.md` (and any change of `plan.md`) are written in the project's documents language (`language.docs`); keep the table format.
- Pass text to scripts **only through a JSON file** written with the Write tool in `.buggy/.tmp/` (new file name every time). Run scripts only as `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh <script> …`; on `"status":"error"` explain the `message` and stop.
- **One script per Bash call**, exactly in that form: no variables, no `&&`, `;` or pipes, nothing else in the same command (anything else is not pre-approved and asks the user).
- **Follow the plan.** If a step cannot be done as planned, stop and ask; change `plan.md` only with the user's consent and record the deviation in the history.
- **Commits of code only with the user's consent**, through the preview: `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git commit-plan --input <file>` → show branch, files and message → wait for an explicit yes → `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git commit-do --token <token> --input <file with the same content>`. Never run `git commit` yourself.
- **Tests:** use the commands from `.buggy/build-test.md`. If a command is missing, propose one and record it only after the user confirms (as in `/buggy:plan`). Never guess silently.

## Steps

1. Checks: Node/buggy errors in the state → explain and stop. The change must be `planned` or `implementing`; otherwise say which command fits (`change.next`) and stop.
2. **Commit strategy** – ask the user: **(a)** a commit after every step, or **(b)** one commit at the end (or whenever they say). Wait for the answer.
3. When the status is `planned`:
   - run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh change set-status --to implementing` and `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh history init`;
   - write `{"message": "docs: start implementing <id>", "paths": ["changes/<id>/spec.md", "changes/<id>/history.md"]}` to a new input file and run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git commit-docs --input <file>`.
   When the status is already `implementing`, this is a resumed session: run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh steps list` and tell the user where you continue.
4. Read `plan.md`, the spec, `.buggy/build-test.md` and the knowledge files that exist.
5. **For each step** – `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh steps next` gives the next one:
   1. Implement it as the plan says (code and its tests).
   2. Run the relevant tests. Fix failures within the step; if you cannot, stop and ask.
   3. `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh steps tick --step <n>`.
   4. Write `{"step": <n>, "change": "<what was done>", "files": [<changed files>], "notes": "<deviations, if any>"}` to a new input file and run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh history add --input <file>`.
   5. Strategy (a): write `{"message": "<conventional commit message> (S<n>)", "paths": [<code files of the step>, "changes/<id>/plan.md", "changes/<id>/history.md"]}` to a new input file, run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git commit-plan --input <file>`, show the preview and wait for a yes; then `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git commit-do --token <token> --input <new file with the same content>`. The tick and the history row go into the same commit as the code.
   6. A small fix the user asks for meanwhile: write `{"text": "<the fix>"}` and run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh steps add --input <file>`; it becomes the next step.
6. **When no step is left (the `next` step from step 5 is `null`):** run the full test suite. Continue only if it passes, or if the user explicitly accepts the known failures (write them into the history). Fill the **Final test results** section of `history.md`, then run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh change set-status --to implemented`.
7. Final commit (with consent, as in 5.5): everything not committed yet, including `changes/<id>/spec.md` and `history.md`.
8. Next step: `/buggy:review`. The work may also stop at any step and continue in a new session with `/buggy:implement`.
