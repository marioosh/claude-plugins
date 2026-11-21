// Test harness: every test works in a fresh temporary git repository with an
// isolated git configuration, and runs buggy scripts as child processes.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'buggy');
export const SCRIPTS = join(PLUGIN_ROOT, 'scripts');

// Git must not read the developer's own configuration (aliases, hooks, signing…).
export const GIT_ENV = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

function env(extra = {}) {
  return { ...process.env, ...GIT_ENV, ...extra };
}

function insideGitRepo(dir) {
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, env: env(), encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() === 'true';
}

// A fresh empty directory (not a git repo). Refuses to work inside an existing
// repository, so a test can never touch a real project.
export function tempDir(t) {
  const base = realpathSync(tmpdir());
  if (insideGitRepo(base)) throw new Error(`Temporary directory ${base} is inside a git repository; refusing to run tests.`);
  const dir = mkdtempSync(join(base, 'buggy-test-'));
  t?.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function gitIn(dir, args) {
  return execFileSync('git', args, { cwd: dir, env: env(), encoding: 'utf8' }).replace(/\n$/, '');
}

export function writeFile(dir, rel, content) {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  return p;
}

// A fresh git repository on branch `main` with one initial commit.
export function tempRepo(t, { commit = true } = {}) {
  const dir = tempDir(t);
  gitIn(dir, ['init', '-q', '-b', 'main']);
  if (commit) {
    writeFile(dir, 'README.md', '# test\n');
    gitIn(dir, ['add', 'README.md']);
    gitIn(dir, ['commit', '-q', '-m', 'init']);
  }
  return dir;
}

// Run a buggy script (through run.sh, exactly as skills do) and parse its JSON.
export function runScript(name, args = [], { cwd, envExtra } = {}) {
  const r = spawnSync('sh', [join(SCRIPTS, 'run.sh'), name, ...args], {
    cwd,
    env: env(envExtra),
    encoding: 'utf8',
  });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    // leave json null; the test will report stdout
  }
  return { code: r.status, json, stdout: r.stdout, stderr: r.stderr };
}
