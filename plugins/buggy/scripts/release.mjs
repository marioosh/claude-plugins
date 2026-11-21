#!/usr/bin/env node
// Publishing a released version (procedure: .buggy/release.md).
//
//   release.mjs target [--version X.Y.Z|latest]     which version, its tag and release note, worktree needed?
//   release.mjs worktree-add --version X.Y.Z        temporary worktree at the tag in .buggy/.tmp/release-vX.Y.Z
//   release.mjs worktree-remove --version X.Y.Z     remove it again

import { run, parse, fail } from './lib/cli.mjs';
import { loadProject } from './lib/config.mjs';
import { target, worktreeAdd, worktreeRemove } from './lib/release.mjs';

await run(async () => {
  const { values, positionals } = parse({ version: { type: 'string' } });
  const [cmd] = positionals;
  const { root, config } = await loadProject();
  if (cmd === 'target') return target(root, config, values.version ?? 'latest');
  if (cmd === 'worktree-add') return worktreeAdd(root, values.version);
  if (cmd === 'worktree-remove') return worktreeRemove(root, values.version);
  fail('bad-arguments', 'Usage: release.mjs target | worktree-add | worktree-remove');
});
