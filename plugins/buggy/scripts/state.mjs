#!/usr/bin/env node
// Project state for skills (injected with `!`). Never exits with an error code:
// a failing `!` command would abort the skill.

import { run } from './lib/cli.mjs';
import { computeState } from './lib/state.mjs';

await run(() => computeState(), { alwaysZero: true });
