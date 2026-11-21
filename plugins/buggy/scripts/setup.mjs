#!/usr/bin/env node
// Project setup for /buggy:start (works before .buggy/config.yaml exists).
//
//   setup.mjs detect                       read-only: case 1.1 / 1.2 / 1.3 / existing + evidence
//   setup.mjs branch [--main <branch>]     chore/<date>-buggy-setup from the main branch
//   setup.mjs init --input <json>          {mainBranch, version: {file, key?}, language: {…}, initialVersion?}
//   setup.mjs claude-block                 buggy block in CLAUDE.md (between markers, idempotent)
//   setup.mjs move --input <json>          {moves: [{from, to}]}  – git mv only
//   setup.mjs stub --input <json>          {stubs: [{path, target}]} – "moved to" notes in the old places

import { run, parse, fail } from './lib/cli.mjs';
import { repoRoot } from './lib/git.mjs';
import { consumeInput } from './lib/fsutil.mjs';
import { detect, setupBranch, initConfig, claudeBlock, moveAll, writeStubs } from './lib/setup.mjs';

// `detect` is injected by /buggy:start – it must never exit non-zero.
await run(async () => {
  const { values, positionals } = parse({ input: { type: 'string' }, main: { type: 'string' } });
  const [cmd] = positionals;
  if (cmd === 'detect') return detect();
  const root = (await repoRoot()) ?? fail('not-git', 'This folder is not a git repository yet (git init first).');
  const input = () => {
    if (!values.input) fail('bad-arguments', '--input <json> is required.');
    // before init there is no .buggy/ yet – the file is read but only deleted from .buggy/.tmp/
    return consumeInput(root, values.input);
  };
  if (cmd === 'branch') return setupBranch(root, values.main ?? 'main');
  if (cmd === 'init') return initConfig(root, input());
  if (cmd === 'claude-block') return claudeBlock(root);
  if (cmd === 'move') return moveAll(root, input().moves);
  if (cmd === 'stub') return writeStubs(root, input().stubs);
  fail('bad-arguments', 'Usage: setup.mjs detect | branch | init | claude-block | move | stub');
}, { alwaysZero: ['detect'] });
