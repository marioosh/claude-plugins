---
name: clarify
description: Analyse the current change's specification, ask clarifying questions and record the decisions in the spec.
argument-hint: "[change id]"
disable-model-invocation: true
effort: high
allowed-tools: Bash(sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh *), Edit(/.buggy/.tmp/**)
---

# buggy: clarify

Project state:

!`sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh state`

Arguments from the user: $ARGUMENTS

## Rules

- Talk to the user in the language they use (when they have not written anything yet – a command and its arguments such as `latest`, `final` or a version do not count – use `language.docs` from the state). The language of the files you write (e.g. English in `.buggy/`) never changes the language you talk in. Write in the specification in the project's documents language (`language.docs`).
- Pass text to scripts **only through a JSON file** written with the Write tool in `.buggy/.tmp/` (new file name every time). Run scripts only as `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh <script> …`; on `"status":"error"` explain the `message` and stop.
- **One script per Bash call**, exactly in that form: no variables, no `&&`, `;` or pipes, nothing else in the same command (anything else is not pre-approved and asks the user).
- **Never edit the frontmatter** (the block between the first two `---` lines) of `spec.md`. Status and kind change only through the scripts.
- The specification is the user's text: change it only to record what the user decided, and say what you changed.
- **The user may answer in the chat or in the file** – answers next to the questions, notes, `<!-- comments -->` in `spec.md`. When they say they edited it, and always before you record answers, **read the file again**: treat their notes as answers (ask when one is unclear), record them like chat answers (step 5), then remove the notes that are now recorded. Never overwrite their edits with an older version of the file.
- Do not read files in `releases/` or `archive/` unless the user asks or the spec's **References** section lists them.
- **Work already on the change branch belongs to this change.** `change.branchWork` lists what the branch holds besides the change's own documents (`commits`, `files`) – e.g. commits merged in from another branch. It is not on the main branch and not released: never call the change done or propose abandoning it because of that work; read those files (`git diff` of the branch is not needed – open them) and describe the work in the specification (Requirements, Acceptance criteria) – the questions are about what is still missing or unclear.

## Steps

1. Checks: Node/buggy errors in the state → explain and stop. The change is `change` from the state, or the id given as an argument (then the user must be on its branch `feature/<id>`; if not, tell them to switch and stop). Its status must be `draft`, `clarified` or `planned`; otherwise say which command fits (`change.next`) and stop.
2. **Read** `changes/<id>/spec.md`, the project knowledge files that exist (`.buggy/project.md`, `.buggy/requirements.md`, `.buggy/architecture.md`, `.buggy/stack.md`) and the files listed under **References**.
3. **Analyse thoroughly now** – this first answer is where the deep thinking happens: missing information, ambiguities, contradictions (inside the spec and with the project knowledge), requirements without acceptance criteria, edge cases, risks, scope that is unclear or too large, and whether the change kind (`major` / `minor` / `bugfix`) fits.
4. Give a short summary of your understanding, then **all questions, numbered and grouped by topic** (at most ~5 per group). For each question, propose an answer when you can. Ask the user to answer the first group (or all of them).
5. After each answer: record it in the spec – a row in the **Clarifications** table (question → decision) and the matching update of Requirements / Acceptance criteria / Out of scope. Remove answered items from **Open questions**. Tell the user what you changed. Continue with the next group.
6. **Change kind:** if the answers show a different kind, propose it. Run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh change set-kind --kind <kind>` only after the user agrees; `major` only after their explicit yes.
7. When nothing is open (or the user decides to leave the rest open), ask explicitly: **is the specification clarified?** Only after a clear yes:
   - run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh change set-status --to clarified`;
   - write `{"message": "docs: clarify <id>", "paths": ["changes/<id>/spec.md"]}` to a new input file and run `sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh git commit-docs --input <file>`.
8. Next step: `/buggy:plan`. If the user edits the spec later, `/buggy:clarify` can be run again.
