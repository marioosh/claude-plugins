#!/usr/bin/env node
// Ideas (ideas/<id>.md).
//
//   ideas.mjs create --input <json>   {title, description?} – writes the idea file (no commit)
//   ideas.mjs list                    ideas in the working tree and on every local branch
//   ideas.mjs show --id <id>          text of one idea

import { run, parse, fail } from './lib/cli.mjs';
import { loadProject } from './lib/config.mjs';
import { consumeInput } from './lib/fsutil.mjs';
import { createIdea, listIdeas, showIdea } from './lib/ideas.mjs';

// `list` is injected by /buggy:version – it must never exit non-zero.
await run(async () => {
  const { values, positionals } = parse({ input: { type: 'string' }, id: { type: 'string' } });
  const [cmd] = positionals;
  const { root } = await loadProject();

  if (cmd === 'create') {
    if (!values.input) fail('bad-arguments', '--input <json> is required.');
    return createIdea(root, consumeInput(root, values.input));
  }
  if (cmd === 'list') {
    const ideas = await listIdeas(root);
    return { count: ideas.length, ideas };
  }
  if (cmd === 'show') {
    if (!values.id) fail('bad-arguments', '--id is required.');
    return showIdea(root, values.id);
  }
  fail('bad-arguments', 'Usage: ideas.mjs create | list | show');
}, { alwaysZero: ['list'] });
