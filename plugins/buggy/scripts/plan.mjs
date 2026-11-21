#!/usr/bin/env node
// Implementation plan of a change.
//
//   plan.mjs init [--id <id>]    changes/<id>/plan.md from the template (only if missing)
//   plan.mjs check [--id <id>]   validate the "## Steps" checklist

import { run, parse, fail } from './lib/cli.mjs';
import { loadProject } from './lib/config.mjs';
import { currentBranch } from './lib/git.mjs';
import { loadChange, idFromBranch } from './lib/change.mjs';
import { initPlan, loadPlan, checkSteps } from './lib/plan.mjs';
import { assertId } from './lib/ids.mjs';

await run(async () => {
  const { values, positionals } = parse({ id: { type: 'string' } });
  const [cmd] = positionals;
  const { root } = await loadProject();
  const id = assertId(values.id ?? idFromBranch(await currentBranch(root)) ?? fail('no-change', 'Not on a change branch (feature/<id>); pass --id.'));
  const change = loadChange(root, id);

  if (cmd === 'init') return { id, ...initPlan(root, id, change.meta.title) };
  if (cmd === 'check') return { id, ...checkSteps(loadPlan(root, id)) };
  fail('bad-arguments', 'Usage: plan.mjs init | check');
});
