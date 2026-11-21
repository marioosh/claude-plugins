---
name: plan
description: Prepare the implementation plan for the current change and iterate on it with the user until they accept it.
argument-hint: "[change id]"
disable-model-invocation: true
effort: high
allowed-tools: Bash(sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh *), Edit(/.buggy/.tmp/**)
---

# buggy: plan

Project state:

!`sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh state`

Arguments from the user: $ARGUMENTS

## Rules

- Talk to the user in the language they use (when they have not written anything yet – a command and its arguments such as `latest`, `final` or a version do not count – use `language.docs` from the state). The language of the files you write (e.g. English in `.buggy/`) never changes the language you talk in. Write the plan in the project's documents language (`language.docs`); keep the headings of the template.
- Pass text to scripts **only through a JSON file** written with the Write tool in `.buggy/.tmp/` (new file name every time). Run scripts only as `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh <script> …`; on `"status":"error"` explain the `message` and stop.
- **One script per Bash call**, exactly in that form: no variables, no `&&`, `;` or pipes, nothing else in the same command (anything else is not pre-approved and asks the user).
- **Planning changes no code.** You write `changes/<id>/plan.md` and, when needed, `.buggy/build-test.md` – nothing else.
- **The user may comment in the chat or in the file** – notes, answers next to the decisions, `<!-- comments -->` in `plan.md` (or `spec.md`). When they say they edited it, and always before you change the plan, **read the file again**: treat their notes as answers or requests (ask when one is unclear), work them into the plan, then remove the notes that are now handled. Never overwrite their edits with an older version of the file. A change of `spec.md` needs `/buggy:clarify` again (step 1).
- Every open technical choice is a question to the user, not your silent decision. The project's own rules (`CLAUDE.md`, `AGENTS.md`, `.buggy/*.md`) win over your habits.
- Do not read `releases/` or `archive/` unless the user asks or the spec's **References** lists the file.
- **Work already on the change branch belongs to this change.** `change.branchWork` lists what the branch holds besides the change's own documents (`commits`, `files`) – e.g. commits merged in from another branch. It is not on the main branch and not released: never call the change done or propose abandoning it because of that work; read those files (`git diff` of the branch is not needed – open them) and describe the work in the plan: steps for work that is already there verify it (tests, checks) instead of doing it again.

## Steps

1. Checks: Node/buggy errors in the state → explain and stop. The change (`change` in the state, or the id argument on its branch) must be `clarified` (or `planned`, to revise an accepted plan). If `change.specChanged` is true → the spec changed after clarification: suggest `/buggy:clarify` and stop. Other statuses → say which command fits (`change.next`) and stop.
2. Run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh plan init`.
3. **Read** the spec, `plan.md`, the project knowledge files that exist (`.buggy/project.md`, `.buggy/requirements.md`, `.buggy/architecture.md`, `.buggy/stack.md`, `.buggy/build-test.md`), the files under References, and the code this change touches (search it yourself, or use the Explore agent for a broad search).
4. **First answer – the full draft.** Write the whole plan into `plan.md`: Goal, Decisions (question → decision; mark your own proposals "to confirm"), Scope, Solution design, Tests, External dependencies, Risks, Documentation impact, and **Steps**:
   - `- [ ] S1. <text>` … numbered 1..n, one line each, nothing else in that list;
   - small steps that each end in a working, testable state; tests belong to the step that changes the code;
   - the last step runs the full test suite and updates the documentation named in "Documentation impact".
5. **Test commands (principle 5).** If `.buggy/build-test.md` is missing or lacks a command the plan needs: run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh knowledge init --name build-test`, look at the project (README, package.json, Makefile, mix.exs, pyproject.toml, CI config…), **propose** the commands and write them into `.buggy/build-test.md` only after the user confirms. Then you may offer – never do it without an explicit yes – an `allow` rule for these commands in `.claude/settings.json`, so tests run without prompts.
6. Show a short summary of the plan and the open questions. Iterate: the user comments → you ask → you edit `plan.md` → repeat. Say what you changed each time.
7. **Acceptance:** only an explicit acceptance of the **whole** plan counts ("looks good" about one section does not). Ask when in doubt. Then:
   - run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh plan check` and fix every problem it reports;
   - run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh change set-status --to planned`;
   - write `{"message": "docs: plan <id>", "paths": ["changes/<id>/plan.md", "changes/<id>/spec.md"]}` (add `".buggy/build-test.md"` when it changed) to a new input file and run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git commit-docs --input <file>`.
8. Next step: `/buggy:implement`.
