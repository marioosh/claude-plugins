#!/usr/bin/env node
// SessionStart hook: a few lines of context for Claude in a buggy project
// (the plugin's own CLAUDE.md is not loaded, so the core rules travel here).
// Plain-text stdout is added to Claude's context. Always exit 0; silent on error.

import { computeState } from './lib/state.mjs';

try {
  const s = await computeState(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (s.buggy) {
    const v = s.version;
    const lines = [];
    const tag = v.main && v.mainTagged ? ` (tag v${v.main})` : '';
    lines.push(`buggy project: version ${v.main ?? 'unknown'}${tag} on ${s.mainBranch}; current branch: ${s.branch ?? 'detached HEAD'}.`);
    if (s.change) {
      const c = s.change;
      lines.push(
        `Current change ${c.id} "${c.title}": status ${c.status}, ${c.change}${c.wouldBe ? ` (would ship as ${c.wouldBe})` : ''}.${c.progress ? ` Plan: ${c.progress.done}/${c.progress.total} steps done.` : ''}${c.review ? ` Review: ${c.review.rounds} round(s), ${c.review.open} open finding(s).` : ''}${c.next ? ` Next: ${c.next}.` : ''}`,
      );
    }
    const others = s.changes.filter((c) => !s.change || c.id !== s.change.id).length;
    if (others) lines.push(`Other changes in progress: ${others} (see /buggy:version).`);
    if (s.warnings.length) lines.push(`Warnings: ${s.warnings.length} (see /buggy:version).`);
    lines.push(
      'buggy rules: never commit to the main branch, never push; project knowledge is in .buggy/; do not read releases/ or archive/ unless the user asks or the current spec references them; the user decides.',
    );
    process.stdout.write(`${lines.join('\n')}\n`);
  }
} catch {
  // silent
}
process.exitCode = 0;
