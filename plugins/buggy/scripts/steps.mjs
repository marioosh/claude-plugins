#!/usr/bin/env node
// Steps of the implementation plan.
//
//   steps.mjs list [--id <id>]              all steps + progress
//   steps.mjs next [--id <id>]              first unchecked step (null when all are done)
//   steps.mjs tick --step <n> [--id <id>]   check step n
//   steps.mjs add --input <json> [--id]     {text} – new step at the end (small fixes, D-11)

import { run, parse, fail } from './lib/cli.mjs';
import { loadProject } from './lib/config.mjs';
import { consumeInput } from './lib/fsutil.mjs';
import { currentBranch } from './lib/git.mjs';
import { loadChange, idFromBranch } from './lib/change.mjs';
import { loadPlan, parseSteps, progress, tickStep, addStep } from './lib/plan.mjs';
import { assertId } from './lib/ids.mjs';

await run(async () => {
  const { values, positionals } = parse({ id: { type: 'string' }, step: { type: 'string' }, input: { type: 'string' } });
  const [cmd] = positionals;
  const { root } = await loadProject();
  const id = assertId(values.id ?? idFromBranch(await currentBranch(root)) ?? fail('no-change', 'Not on a change branch (feature/<id>); pass --id.'));
  loadChange(root, id);

  if (cmd === 'list' || cmd === 'next') {
    const text = loadPlan(root, id);
    const steps = parseSteps(text).steps.map(({ n, text: t, done }) => ({ n, text: t, done }));
    if (cmd === 'list') return { id, steps, progress: progress(text) };
    return { id, next: steps.find((s) => !s.done) ?? null, progress: progress(text) };
  }
  if (cmd === 'tick') {
    if (!/^\d+$/.test(values.step ?? '')) fail('bad-arguments', '--step <n> is required.');
    const step = tickStep(root, id, Number(values.step));
    return { id, ticked: step, progress: progress(loadPlan(root, id)) };
  }
  if (cmd === 'add') {
    if (!values.input) fail('bad-arguments', '--input <json> is required.');
    const step = addStep(root, id, consumeInput(root, values.input).text);
    return { id, added: step, progress: progress(loadPlan(root, id)) };
  }
  fail('bad-arguments', 'Usage: steps.mjs list | next | tick | add');
});
