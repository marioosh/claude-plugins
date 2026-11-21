#!/usr/bin/env node
// The project's git hooks.
//
//   githooks.mjs check                         is everything installed and current?
//   githooks.mjs install --mode fresh|append   write .githooks/buggy-tag.sh and the post-merge/post-commit calls
//   githooks.mjs tag-now                       run the tagging script now (on the main branch)

import { run, parse, fail } from './lib/cli.mjs';
import { loadProject } from './lib/config.mjs';
import { checkHooks, installHooks, tagNow } from './lib/githooks.mjs';

await run(async () => {
  const { values, positionals } = parse({ mode: { type: 'string' } });
  const [cmd] = positionals;
  const { root, config } = await loadProject();
  if (cmd === 'check') return checkHooks(root, config);
  if (cmd === 'install') return { ...(await installHooks(root, config, values.mode)), check: await checkHooks(root, config) };
  if (cmd === 'tag-now') return tagNow(root);
  fail('bad-arguments', 'Usage: githooks.mjs check | install --mode fresh|append | tag-now');
});
