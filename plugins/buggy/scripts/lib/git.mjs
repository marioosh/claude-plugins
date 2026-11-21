// The only place where buggy runs git.
// Always execFile (no shell): arguments go straight to git, so text such as
// `; rm -rf ~` or `$(...)` in a name can never be interpreted as a command.
// Paths are always passed after `--`, so a path can never be read as an option.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { fail } from './cli.mjs';
import { ensureDir } from './fsutil.mjs';

const execFileP = promisify(execFile);

export async function git(args, { cwd = process.cwd(), allowFail = false, env, input } = {}) {
  try {
    const opts = {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      maxBuffer: 16 * 1024 * 1024,
    };
    const { stdout } = await execFileP('git', args, opts);
    return stdout.replace(/\n$/, '');
  } catch (err) {
    if (allowFail) return null;
    const msg = (err.stderr || err.message || '').toString().trim();
    fail('git-failed', `git ${args[0]} failed: ${msg}`);
  }
}

// Repository root for `cwd`, or null when not inside a git work tree.
export async function repoRoot(cwd = process.cwd()) {
  return git(['rev-parse', '--show-toplevel'], { cwd, allowFail: true });
}

export async function currentBranch(cwd) {
  const name = await git(['branch', '--show-current'], { cwd, allowFail: true });
  return name || null; // empty when HEAD is detached
}

export async function headCommit(cwd) {
  return git(['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd, allowFail: true });
}

// Parsed `git status --porcelain=v1 -z`: [{ x, y, path, from? }].
// Model input files in `.buggy/.tmp/` are never part of the status (D-40).
const IGNORED = '.buggy/.tmp/';

export async function status(cwd) {
  const out = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd });
  const parts = out.split('\0').filter((p) => p !== '');
  const entries = [];
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    const x = rec[0];
    const y = rec[1];
    const path = rec.slice(3);
    const entry = { x, y, path };
    if (x === 'R' || x === 'C') entry.from = parts[++i];
    if (!path.startsWith(IGNORED)) entries.push(entry);
  }
  return entries;
}

export async function isClean(cwd) {
  return (await status(cwd)).length === 0;
}

export async function branchExists(cwd, name) {
  return (await git(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], { cwd, allowFail: true })) !== null;
}

export async function localBranches(cwd) {
  const out = await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], { cwd });
  return out ? out.split('\n') : [];
}

export async function isValidBranchName(cwd, name) {
  if (typeof name !== 'string' || name.startsWith('-')) return false;
  return (await git(['check-ref-format', '--branch', name], { cwd, allowFail: true })) !== null;
}

// Create `name` from `from` and switch to it.
export async function switchCreate(cwd, name, from) {
  if (!(await isValidBranchName(cwd, name))) fail('bad-branch', `Invalid branch name: ${name}`);
  if (await branchExists(cwd, name)) fail('branch-exists', `Branch already exists: ${name}`);
  if (!(await branchExists(cwd, from))) fail('branch-missing', `Branch does not exist: ${from}`);
  await git(['switch', '-c', name, from], { cwd });
}

// File content at `ref` (e.g. "main"), or null when the file or ref does not exist.
export async function show(cwd, ref, path) {
  return git(['show', `${ref}:${path}`], { cwd, allowFail: true });
}

export async function add(cwd, paths) {
  if (paths.length === 0) return;
  await git(['add', '--', ...paths], { cwd });
}

// Paths currently staged in the index.
export async function stagedPaths(cwd) {
  const out = await git(['diff', '--cached', '--name-only', '-z'], { cwd });
  return out.split('\0').filter((p) => p !== '');
}

// Commit exactly `paths` (staged first) with the message read from a file
// (message text never travels through command-line arguments).
export async function commitPaths(cwd, paths, messageFile) {
  // Existing files are added; removed files (also the source of a `git mv`)
  // are staged as deletions – `git add` fails on a path already gone from the index.
  const present = [];
  const removed = [];
  for (const p of paths) {
    const inTree = await git(['ls-files', '--error-unmatch', '--', p], { cwd, allowFail: true });
    const onDisk = existsSync(join(cwd, p));
    if (onDisk) present.push(p);
    else if (inTree !== null) removed.push(p);
  }
  await add(cwd, present);
  if (removed.length) await git(['rm', '--cached', '--quiet', '--ignore-unmatch', '--', ...removed], { cwd });
  await git(['commit', '--quiet', '-F', messageFile, '--', ...paths], { cwd });
  return headCommit(cwd);
}

// `cwd` must be the repository root; the target's parent directory is created
// (git mv does not create it).
export async function mv(cwd, from, to) {
  const parent = dirname(to);
  if (parent !== '.') ensureDir(cwd, parent);
  await git(['mv', '--', from, to], { cwd });
}

// Blob id of the working-tree file at `path` (as git would store it).
export async function hashObject(cwd, path) {
  return git(['hash-object', '--', path], { cwd });
}

// Tags matching `vX.Y.Z`, highest version first.
export async function versionTags(cwd) {
  const out = await git(['tag', '--list', 'v*', '--sort=-v:refname'], { cwd });
  return out ? out.split('\n').filter((t) => /^v\d+\.\d+\.\d+$/.test(t)) : [];
}

// Commit a tag points to, or null.
export async function tagCommit(cwd, tag) {
  return git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], { cwd, allowFail: true });
}

export async function gitVersion() {
  const out = await git(['--version'], { allowFail: true });
  const m = out && out.match(/(\d+)\.(\d+)/);
  return m ? { major: Number(m[1]), minor: Number(m[2]), text: out } : null;
}

// Raw stdout of a git command that may exit with 1 when there are differences
// (e.g. `git diff --no-index`).
export async function gitOutput(args, { cwd } = {}) {
  try {
    const { stdout } = await execFileP('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    if (err.code === 1 && typeof err.stdout === 'string') return err.stdout;
    const msg = (err.stderr || err.message || '').toString().trim();
    fail('git-failed', `git ${args[0]} failed: ${msg}`);
  }
}
