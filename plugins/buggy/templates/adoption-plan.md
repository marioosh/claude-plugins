# Adoption plan – buggy

<!-- Written by /buggy:start for a project that already had its own
     spec-driven practice (case 1.3, D-9). Nothing is moved before the user
     chooses a variant; this file stays in the repository as the record of why
     the structure looks the way it does. -->

- **Status:** proposal

## What was found

## Variants

### A – archive and initial state

<!-- The old process files move unchanged to archive/; the current state
     (version, project knowledge, future work) moves to .buggy/ and ideas/. -->

### B – migration per version

<!-- Every released version moves to releases/X.Y.Z-<name>/ in the buggy format. -->

## Mapping (chosen variant)

| Now | After | How | Notes |
|---|---|---|---|

<!-- How: git mv (history kept) / stub (note left in the old place) / idea / new / stays. -->

## Claude configuration

## Git hooks

## Commit sequence

1. Moves only (`git mv`) – no content changes, so git keeps the history of every file.
2. Notes in the old places of moved living documents.
3. New `.buggy/` files, ideas, the buggy block in `CLAUDE.md`, git hooks.

## Open questions
