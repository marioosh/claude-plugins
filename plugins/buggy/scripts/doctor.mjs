#!/usr/bin/env node
// Project checks (read-only).
//
//   doctor.mjs check     quick checks → { ok, errors, warnings, infos, findings[] }
//   doctor.mjs context   files for the model analysis of `/buggy:doctor full`

import { run, parse, fail } from './lib/cli.mjs';
import { repoRoot } from './lib/git.mjs';
import { runDoctor, doctorContext } from './lib/doctor.mjs';

// `check` is injected by /buggy:doctor – it must never exit non-zero.
await run(async () => {
  const { positionals } = parse({});
  const [cmd] = positionals;
  if (cmd === 'check') {
    const root = await repoRoot();
    if (!root) fail('not-git', 'This folder is not inside a git repository.');
    return runDoctor(root);
  }
  if (cmd === 'context') {
    const root = await repoRoot();
    if (!root) fail('not-git', 'This folder is not inside a git repository.');
    return doctorContext(root);
  }
  fail('bad-arguments', 'Usage: doctor.mjs check | context');
}, { alwaysZero: ['check'] });
