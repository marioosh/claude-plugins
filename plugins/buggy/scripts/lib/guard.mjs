// PreToolUse decisions for buggy projects (D-42, stage 2 P6).
//
// deny  – `git commit` on the main branch, any `git push` (protection against
//         model mistakes, not a security boundary: a script can still run git);
// allow – exactly buggy's own commands, which skills need in later dialog turns
//         (skill `allowed-tools` only covers the turn that invoked the skill):
//         * Bash: `sh <this plugin>/scripts/run.sh <name> <safe args>`
//         * Write: a `*.json` file inside `<project>/.buggy/.tmp/`
// null  – no opinion: the user's normal permissions apply.
//
// The user's own deny/ask rules still win over an "allow" (Claude Code hooks docs).

import { realpathSync, existsSync } from 'node:fs';
import { join, dirname, isAbsolute, relative } from 'node:path';
import { repoRoot, currentBranch } from './git.mjs';
import { loadConfig } from './config.mjs';

const SAFE_ARG = /^[A-Za-z0-9._\/=-]+$/;
const SCRIPT_NAME = /^[a-z0-9-]+$/;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// `sh <root>/scripts/run.sh name args…` – optionally with the path in double quotes.
export function isOwnScriptCall(command, pluginRoot) {
  if (typeof command !== 'string' || !pluginRoot || /[\n\r]/.test(command)) return false;
  const runSh = `${pluginRoot.replace(/\/+$/, '')}/scripts/run.sh`;
  const m = command.trim().match(new RegExp(`^sh +("?)${escapeRe(runSh)}\\1((?: +\\S+)*)$`));
  if (!m) return false;
  const args = m[2].trim().split(/ +/).filter(Boolean);
  if (args.length === 0 || !SCRIPT_NAME.test(args[0])) return false;
  return args.slice(1).every((a) => SAFE_ARG.test(a));
}

// git commit / git push anywhere in a (possibly compound) command.
const GIT_OPTS = String.raw`(?:\s+(?:-C\s+\S+|-c\s+\S+|--[a-z-]+(?:=\S+)?))*`;
const GIT_SUB = (sub) => new RegExp(String.raw`(?:^|[\s;&|(\x60]|\$\()git${GIT_OPTS}\s+${sub}(?:\s|$|;|&|\|)`);
export const isGitCommit = (cmd) => GIT_SUB('commit').test(cmd);
export const isGitPush = (cmd) => GIT_SUB('push').test(cmd);

function inside(base, target) {
  const rel = relative(base, target);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

// Absolute *.json path inside <root>/.buggy/.tmp/, also after resolving the parent directory.
export function isInputFileWrite(filePath, root) {
  if (typeof filePath !== 'string' || !isAbsolute(filePath) || !filePath.endsWith('.json')) return false;
  const realRoot = realpathSync(root);
  const tmp = join(realRoot, '.buggy', '.tmp');
  let parent = dirname(filePath);
  try {
    if (existsSync(parent)) parent = realpathSync(parent);
  } catch {
    return false;
  }
  const target = join(parent, filePath.slice(dirname(filePath).length + 1));
  return inside(tmp, target);
}

// → { decision: 'allow' | 'deny', reason } or null.
export async function decide(event, { pluginRoot } = {}) {
  const tool = event?.tool_name;
  const input = event?.tool_input ?? {};
  const cwd = event?.cwd || process.cwd();
  if (tool !== 'Bash' && tool !== 'Write') return null;

  const root = await repoRoot(cwd);
  if (!root) return null;
  const config = loadConfig(root); // throws on a broken config → caller fails open
  if (!config) return null;

  if (tool === 'Write') {
    return isInputFileWrite(input.file_path, root)
      ? { decision: 'allow', reason: 'buggy: input file for a buggy script (.buggy/.tmp/)' }
      : null;
  }

  const cmd = String(input.command ?? '');
  if (isGitPush(cmd)) {
    return { decision: 'deny', reason: 'buggy: Claude never pushes. Tell the user which command to run themselves.' };
  }
  if (isGitCommit(cmd) && (await currentBranch(root)) === config.mainBranch) {
    return {
      decision: 'deny',
      reason: `buggy: no commits on ${config.mainBranch}. Work on a change branch (/buggy:new) or ask the user to commit.`,
    };
  }
  if (isOwnScriptCall(cmd, pluginRoot)) {
    return { decision: 'allow', reason: 'buggy: own script' };
  }
  return null;
}
