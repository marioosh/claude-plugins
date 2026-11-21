#!/usr/bin/env node
// PreToolUse hook (Bash, Write). Reads the hook event from stdin and prints a
// hook decision (Claude Code hook JSON), or nothing. Fails open: any error →
// no output, exit 0, so the user's normal permissions apply.

import { readFileSync } from 'node:fs';
import { decide } from './lib/guard.mjs';

try {
  const event = JSON.parse(readFileSync(0, 'utf8'));
  const result = await decide(event, { pluginRoot: process.env.CLAUDE_PLUGIN_ROOT });
  if (result) {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: result.decision,
          permissionDecisionReason: result.reason,
        },
      })}\n`,
    );
  }
} catch {
  // fail open
}
process.exitCode = 0;
