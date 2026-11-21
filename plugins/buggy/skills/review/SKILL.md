---
name: review
description: Review the current change - independent reviewer agents, findings verified in the code, decisions and fixes in rounds, a final full review and the user's acceptance.
argument-hint: "[final]"
disable-model-invocation: true
effort: high
allowed-tools: Bash(sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh *), Edit(/.buggy/.tmp/**)
---

# buggy: review

Project state:

!`sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh state`

Arguments from the user: $ARGUMENTS

## Rules

- Talk to the user in the language they use (when they have not written anything yet – a command and its arguments such as `latest`, `final` or a version do not count – use `language.docs` from the state). The language of the files you write (e.g. English in `.buggy/`) never changes the language you talk in. Write in `review.md` in the project's documents language (`language.docs`); keep the table format.
- Pass text to scripts **only through a JSON file** written with the Write tool in `.buggy/.tmp/` (new file name every time). Run scripts only as `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh <script> …`; on `"status":"error"` explain the `message` and stop.
- **One script per Bash call**, exactly in that form: no variables, no `&&`, `;` or pipes, nothing else in the same command (anything else is not pre-approved and asks the user).
- **The reviewers must stay independent:** give them only the paths listed in step 3 – never your summary, your opinion or the user's.
- **The user decides** about every finding. Commits of code only through the preview: `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git commit-plan --input <file>` → show it → explicit yes → `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git commit-do --token <token> --input <new file, same content>`.

## Steps

1. Checks: Node/buggy errors → explain and stop. The change must be `implemented`, `in-review` or `approved` (reopening); otherwise say which command fits (`change.next`) and stop.
2. **Round type:** `final` when the argument is `final` or the user wants to finish; otherwise `incremental`. The first round always covers the whole change. Suggest `final` when the previous round ended without any `fix`.
3. Run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh review round-start --type <type>`. If `files` is empty, say there is nothing new to review and go to step 9. On `diff-too-large`: review in groups of files (tell each reviewer which files of `details.files` to look at).
4. Start **both reviewers in parallel** (two Agent tool calls in one message), `subagent_type` `buggy:code-reviewer` and `buggy:security-reviewer`. The prompt is only:
   `Diff: <diff from step 3>. Specification: changes/<id>/spec.md. Plan: changes/<id>/plan.md. Round: <type>.`
5. **Verify every finding in the code** before showing it: open the location, check the evidence. Drop false positives and merge duplicates. For each confirmed finding write `{"source": "<agent name>", "severity": …, "finding": "<finding + short evidence>", "location": "<path:line>"}` and run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh review finding-add --input <file>`.
6. Show the user the confirmed findings (id, severity, location, finding), how many you dropped as false positives, and **your proposed decision** for each: `fix`, `reject` (with a reason) or `defer` (to an idea). Ask for their decisions and for their own remarks – add remarks as findings with `"source": "user"`.
7. Apply each decision with `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh review finding-update --finding <id> --input <file>`:
   - `fix`: change the code, run the tests from `.buggy/build-test.md`, add a history row (`{"step": "<finding id>", "change": …, "files": […]}` → `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh history add --input <file>`), then `{"decision": "fix", "status": "done"}`;
   - `reject`: `{"decision": "reject – <reason>", "status": "done"}`;
   - `defer`: write `{"title": …, "description": "<the finding> (from review of <change id>, <finding id>)"}` → `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh ideas create --input <file>`, then `{"decision": "defer → idea <idea id>", "status": "done"}`.
   Offer to commit the fixes (code + `review.md` + `history.md`) through the preview; the user may also commit themselves – a commit is the round's checkpoint.
8. Run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh review round-end`. If this round led to any `fix`, the next round is needed (`/buggy:review`, or `/buggy:review final` to finish). Any review documents still uncommitted after the round (e.g. a round without fixes) – except in a final round that goes on to step 9 – are committed now: `{"message": "docs: review round <n> of <id>", "paths": ["changes/<id>/"]}` (the folder stands for its changed files) → `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git commit-docs --input <file>`; `nothing-to-commit` means there is nothing left – fine.
9. **Final round only** – after round-end:
   - check every acceptance criterion of the spec against the code and tests; write a table into the **Acceptance criteria check** section of `review.md` (criterion | met | evidence);
   - run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh review status`; if `approval.ok` is false, show the `problems` and continue with another round;
   - otherwise ask explicitly: **do you approve the change?** Only after a clear yes: write the date and "approved by the user" into the **Approval** section, run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh change set-status --to approved`, and commit what is left: when only buggy documents changed, write `{"message": "docs: approve <id>", "paths": ["changes/<id>/review.md", "changes/<id>/spec.md"]}` to a new input file and run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git commit-docs --input <file>`; otherwise use the preview.
10. Next step: `/buggy:ship`.
