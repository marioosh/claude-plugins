#!/usr/bin/env node
// Implementation history of a change.
//
//   history.mjs init [--id <id>]               changes/<id>/history.md from the template (only if missing)
//   history.mjs add --input <json> [--id]      {step?, change, files?, notes?} – one row, dated today

import { run, parse, fail } from './lib/cli.mjs';
import { loadProject } from './lib/config.mjs';
import { consumeInput } from './lib/fsutil.mjs';
import { currentBranch } from './lib/git.mjs';
import { loadChange, idFromBranch } from './lib/change.mjs';
import { initHistory, addRow } from './lib/history.mjs';
import { assertId } from './lib/ids.mjs';

await run(async () => {
  const { values, positionals } = parse({ id: { type: 'string' }, input: { type: 'string' } });
  const [cmd] = positionals;
  const { root } = await loadProject();
  const id = assertId(values.id ?? idFromBranch(await currentBranch(root)) ?? fail('no-change', 'Not on a change branch (feature/<id>); pass --id.'));
  const change = loadChange(root, id);

  if (cmd === 'init') return { id, ...initHistory(root, id, change.meta.title) };
  if (cmd === 'add') {
    if (!values.input) fail('bad-arguments', '--input <json> is required.');
    return { id, ...addRow(root, id, consumeInput(root, values.input)) };
  }
  fail('bad-arguments', 'Usage: history.mjs init | add');
});
