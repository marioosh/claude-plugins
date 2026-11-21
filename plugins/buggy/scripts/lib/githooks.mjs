// The project's git hooks (D-3, D-28, D-31, stage 5 P1–P3, P11).
//
// `.githooks/buggy-tag.sh` is generated from a template with the config values
// written in (no Node needed in the hook). `post-merge` and `post-commit` call it:
// either buggy's own files in `.githooks/` (core.hooksPath = .githooks) or one
// line appended to the project's existing hooks.

import { readFileSync, writeFileSync, chmodSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fail } from './cli.mjs';
import { exists, readText, writeText, resolveInside } from './fsutil.mjs';
import { git } from './git.mjs';

const execFileP = promisify(execFile);
const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'githooks');
export const SCRIPT = '.githooks/buggy-tag.sh';
export const HOOKS = ['post-merge', 'post-commit'];
export const CALL_MARK = '.githooks/buggy-tag.sh';

const SAFE = /^[A-Za-z0-9._\/-]+$/;

function expectedValues(config) {
  const v = { main: config.mainBranch, file: config.version.file, key: config.version.key ?? '' };
  for (const [k, val] of Object.entries(v)) {
    if (val !== '' && !SAFE.test(val)) fail('bad-config', `Cannot write "${val}" (${k}) into the git hook safely.`);
  }
  return v;
}

export function renderScript(config) {
  const v = expectedValues(config);
  return readFileSync(join(TEMPLATES, 'buggy-tag.sh.tpl'), 'utf8')
    .replaceAll('{{main_branch}}', v.main)
    .replaceAll('{{version_file}}', v.file)
    .replaceAll('{{version_key}}', v.key);
}

const hookBody = (name) => readFileSync(join(TEMPLATES, 'hook.tpl'), 'utf8').replaceAll('{{hook}}', name);
const callLine = () => hookBody('x').split('\n').find((l) => l.includes(CALL_MARK));

// Values written into an installed script (the "buggy:config" line).
export function scriptValues(text) {
  const m = text.match(/^# buggy:config main=(\S*) file=(\S*) key=(\S*)$/m);
  return m ? { main: m[1], file: m[2], key: m[3] } : null;
}

export async function effectiveHooksDir(root) {
  const p = await git(['rev-parse', '--git-path', 'hooks'], { cwd: root });
  return isAbsolute(p) ? p : join(root, p);
}

// Active (non-sample, executable) hooks in a directory.
// Names git runs as hooks (githooks(5)). Other files in the hooks directory –
// buggy-tag.sh, helper scripts – are never run by git, so they are not hooks.
const GIT_HOOK_NAMES = new Set([
  'applypatch-msg', 'pre-applypatch', 'post-applypatch', 'pre-commit', 'pre-merge-commit',
  'prepare-commit-msg', 'commit-msg', 'post-commit', 'pre-rebase', 'post-checkout', 'post-merge',
  'pre-push', 'pre-receive', 'update', 'proc-receive', 'post-receive', 'post-update',
  'reference-transaction', 'push-to-checkout', 'pre-auto-gc', 'post-rewrite', 'sendemail-validate',
  'fsmonitor-watchman', 'p4-changelist', 'p4-prepare-changelist', 'p4-post-changelist', 'p4-pre-submit',
  'post-index-change',
]);

export function activeHooks(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => {
    if (!GIT_HOOK_NAMES.has(f)) return false;
    try {
      const st = statSync(join(dir, f));
      return st.isFile() && (st.mode & 0o111) !== 0;
    } catch {
      return false;
    }
  });
}

export async function checkHooks(root, config) {
  const problems = [];
  const hooksPath = await git(['config', '--get', 'core.hooksPath'], { cwd: root, allowFail: true });
  const dir = await effectiveHooksDir(root);
  const insideRepo = !relative(root, dir).startsWith('..');
  const script = { exists: exists(root, SCRIPT), current: false };
  if (!script.exists) problems.push(`${SCRIPT} is missing.`);
  else {
    const vals = scriptValues(readText(root, SCRIPT));
    const want = expectedValues(config);
    script.current = Boolean(vals) && vals.main === want.main && vals.file === want.file && vals.key === want.key;
    if (!script.current) problems.push(`${SCRIPT} does not match .buggy/config.yaml (main branch, version file or key) – reinstall it.`);
  }
  const hooks = {};
  for (const h of HOOKS) {
    const p = join(dir, h);
    const present = existsSync(p);
    const executable = present && (statSync(p).mode & 0o111) !== 0;
    const calls = present && readFileSync(p, 'utf8').includes(CALL_MARK);
    hooks[h] = { present, executable, callsBuggy: calls };
    if (!present) problems.push(`The ${h} hook is missing in ${relative(root, dir) || dir}.`);
    else if (!calls) problems.push(`The ${h} hook does not call ${SCRIPT}.`);
    else if (!executable) problems.push(`The ${h} hook is not executable.`);
  }
  const managers = ['.husky', 'lefthook.yml', '.lefthook.yml', '.pre-commit-config.yaml'].filter((f) => existsSync(join(root, f)));
  return {
    installed: problems.length === 0,
    hooksPath: hooksPath || null,
    effectiveDir: insideRepo ? relative(root, dir) || '.' : dir,
    script,
    hooks,
    managers,
    otherActiveHooks: activeHooks(dir).filter((h) => !HOOKS.includes(h)),
    problems,
  };
}

// mode "fresh": .githooks/ + core.hooksPath (only when no other hooks are active);
// mode "append": add the call line to the hooks in the current hooks directory.
export async function installHooks(root, config, mode) {
  if (!['fresh', 'append'].includes(mode)) fail('bad-arguments', '--mode must be fresh or append.');
  writeText(root, SCRIPT, renderScript(config));
  chmodSync(resolveInside(root, SCRIPT), 0o755);
  const done = [SCRIPT];

  if (mode === 'fresh') {
    const hooksPath = await git(['config', '--get', 'core.hooksPath'], { cwd: root, allowFail: true });
    if (hooksPath && hooksPath !== '.githooks') {
      fail('hooks-path-set', `core.hooksPath is already "${hooksPath}"; use --mode append.`, { hooksPath });
    }
    if (!hooksPath) {
      const others = activeHooks(await effectiveHooksDir(root));
      if (others.length) fail('hooks-active', `The project already has active hooks (${others.join(', ')}); use --mode append.`, { hooks: others });
    }
    for (const h of HOOKS) {
      const rel = `.githooks/${h}`;
      if (exists(root, rel) && readText(root, rel).includes(CALL_MARK)) continue;
      if (exists(root, rel)) writeText(root, rel, `${readText(root, rel).replace(/\n?$/, '\n')}${callLine()}\n`);
      else writeText(root, rel, hookBody(h));
      chmodSync(resolveInside(root, rel), 0o755);
      done.push(rel);
    }
    await git(['config', 'core.hooksPath', '.githooks'], { cwd: root });
    return { mode, files: done, hooksPath: '.githooks' };
  }

  const dir = await effectiveHooksDir(root);
  for (const h of HOOKS) {
    const p = join(dir, h);
    if (existsSync(p)) {
      const text = readFileSync(p, 'utf8');
      if (!text.includes(CALL_MARK)) writeFileSync(p, `${text.replace(/\n?$/, '\n')}${callLine()}\n`);
    } else {
      writeFileSync(p, hookBody(h));
    }
    chmodSync(p, 0o755);
    done.push(relative(root, p));
  }
  return { mode, files: done, hooksPath: null };
}

// Runs the installed tagging script now (same as the hook would) – on the main branch.
export async function tagNow(root) {
  if (!exists(root, SCRIPT)) fail('hooks-missing', `${SCRIPT} is missing – install the hooks first.`);
  try {
    const { stdout, stderr } = await execFileP('sh', [resolveInside(root, SCRIPT)], { cwd: root });
    return { output: `${stdout}${stderr}`.trim() };
  } catch (err) {
    fail('tag-failed', `${err.stderr || err.message}`.trim());
  }
}

// Version as the hook reads it (D-27: compared with the Node parser by doctor).
export async function hookVersion(root) {
  if (!exists(root, SCRIPT)) return null;
  const { stdout } = await execFileP('sh', [resolveInside(root, SCRIPT), '--print-version'], { cwd: root });
  return stdout.trim() || null;
}
