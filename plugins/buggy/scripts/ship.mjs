#!/usr/bin/env node
// Shipping a change.
//
//   ship.mjs sync-plan                       preview of merging the main branch into the change branch
//   ship.mjs sync-do --token <t>             merge (conflicts → listed, merge state kept)
//   ship.mjs sync-continue-plan              after conflicts are resolved: preview of the merge commit
//   ship.mjs sync-continue-do --token <t>    commit the merge
//   ship.mjs prepare --input <json>          {title?, summary, changes[], migration[], limitations[]}:
//                                            version file, shipped status, releases/X.Y.Z-<slug>, release note (no commit)
//   ship.mjs verify                          on the main branch after the merge: version, tag, release folder

import { run, parse, fail } from './lib/cli.mjs';
import { loadProject } from './lib/config.mjs';
import { consumeInput } from './lib/fsutil.mjs';
import { syncPlan, syncDo, syncContinuePlan, syncContinueDo, prepare, verify } from './lib/ship.mjs';

await run(async () => {
  const { values, positionals } = parse({ token: { type: 'string' }, input: { type: 'string' } });
  const [cmd] = positionals;
  const { root, config } = await loadProject();
  const main = config.mainBranch;
  const needToken = () => values.token ?? fail('bad-arguments', '--token is required.');

  if (cmd === 'sync-plan') return syncPlan(root, main);
  if (cmd === 'sync-do') return syncDo(root, main, needToken());
  if (cmd === 'sync-continue-plan') return syncContinuePlan(root);
  if (cmd === 'sync-continue-do') return syncContinueDo(root, needToken());
  if (cmd === 'prepare') {
    if (!values.input) fail('bad-arguments', '--input <json> is required.');
    return prepare(root, config, consumeInput(root, values.input));
  }
  if (cmd === 'verify') return verify(root, config);
  fail('bad-arguments', 'Usage: ship.mjs sync-plan | sync-do | sync-continue-plan | sync-continue-do | prepare | verify');
});
