## buggy (spec-driven development)

This project uses the buggy plugin. Commands: `/buggy:version`, `/buggy:new-idea`, `/buggy:new`,
`/buggy:clarify`, `/buggy:plan`, `/buggy:implement`, `/buggy:review`, `/buggy:ship`, `/buggy:release`,
`/buggy:doctor`.

- Project knowledge is in `.buggy/` (`project.md`, `requirements.md`, `architecture.md`, `stack.md`,
  `build-test.md`, …) – read it before planning or changing code.
- Changes in progress live in `changes/<id>/` on their own branches; ideas in `ideas/`.
- Do not read `releases/` or `archive/` unless the user asks or the current spec references the file.
- Never commit to the main branch and never push. Commits of code only with the user's explicit consent.
- The user decides: what is not explicitly agreed needs their OK.
