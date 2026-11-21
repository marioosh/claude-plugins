// Consent pattern (design §7.2, D-10): the user sees a preview, says yes, and
// the script commits exactly what was shown. The token is a hash of everything
// that makes up the commit; any change after the preview gives a different
// token and the commit is refused. Stateless – nothing is stored.

import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fail } from './cli.mjs';
import { resolveInside, exists } from './fsutil.mjs';
import { status, headCommit, currentBranch, hashObject, commitPaths } from './git.mjs';

export const DOC_PREFIXES = ['changes/', 'ideas/', 'releases/', '.buggy/'];

export function isDocPath(p) {
  return DOC_PREFIXES.some((pre) => p.startsWith(pre));
}

// Changed paths to commit. `paths` omitted → every changed path. Renames pull in
// their source path, so a `git mv` is committed as a whole.
export async function selectPaths(root, paths) {
  const entries = await status(root);
  const changed = new Map(entries.map((e) => [e.path, e]));
  // The source of a rename is part of the same change.
  for (const e of entries) if (e.from && !changed.has(e.from)) changed.set(e.from, { ...e, path: e.from, from: e.path });
  const wanted = paths ?? entries.map((e) => e.path);
  if (!Array.isArray(wanted) || wanted.some((p) => typeof p !== 'string')) fail('bad-input', 'paths must be a list of strings.');
  const out = new Set();
  for (const p of wanted) {
    resolveInside(root, p);
    const e = changed.get(p);
    if (e) {
      out.add(p);
      if (e.from) out.add(e.from);
      continue;
    }
    // A directory stands for every changed file under it.
    const prefix = `${p.replace(/\/+$/, '')}/`;
    const inside = [...changed.values()].filter((x) => x.path.startsWith(prefix));
    if (!inside.length) fail('nothing-to-commit', `No changes in: ${p}`);
    for (const x of inside) {
      out.add(x.path);
      if (x.from) out.add(x.from);
    }
  }
  if (out.size === 0) fail('nothing-to-commit', 'There is nothing to commit.');
  return [...out].sort();
}

async function assertCommitBranch(root, mainBranch) {
  const branch = await currentBranch(root);
  if (!branch) fail('detached-head', 'HEAD is detached; switch to a branch first.');
  if (branch === mainBranch) fail('main-branch', `buggy never commits to ${mainBranch}. Create a branch first.`);
  return branch;
}

function checkMessage(message) {
  if (typeof message !== 'string' || message.trim() === '') fail('bad-input', 'message is required.');
  return message.trim();
}

async function describe(root, files) {
  const entries = new Map((await status(root)).map((e) => [e.path, e]));
  const out = [];
  for (const path of files) {
    const e = entries.get(path);
    const present = exists(root, path);
    out.push({
      path,
      state: e ? `${e.x}${e.y}`.trim() || 'modified' : 'unchanged',
      blob: present ? await hashObject(root, path) : 'deleted',
    });
  }
  return out;
}

function tokenOf(data) {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
}

// Preview + token for a commit of `paths` with `message`.
export async function planCommit(root, mainBranch, { message, paths }) {
  const branch = await assertCommitBranch(root, mainBranch);
  const msg = checkMessage(message);
  const files = await describe(root, await selectPaths(root, paths));
  const head = (await headCommit(root)) ?? 'none';
  return { branch, message: msg, files, token: tokenOf({ head, branch, message: msg, files }) };
}

async function commitWithMessage(root, files, message) {
  const dir = mkdtempSync(join(tmpdir(), 'buggy-msg-'));
  try {
    const file = join(dir, 'message.txt');
    writeFileSync(file, `${message}\n`);
    return await commitPaths(root, files, file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Commits only if the token still matches the current state.
export async function doCommit(root, mainBranch, { message, paths, token }) {
  const plan = await planCommit(root, mainBranch, { message, paths });
  if (plan.token !== token) {
    fail('token-mismatch', 'Something changed since the preview (files, message, branch or HEAD). Show the preview again and ask the user.');
  }
  const commit = await commitWithMessage(root, plan.files.map((f) => f.path), plan.message);
  return { commit, branch: plan.branch, files: plan.files.map((f) => f.path) };
}

// Commit of buggy documents only – allowed without asking (D-10).
export async function commitDocs(root, mainBranch, { message, paths }) {
  const branch = await assertCommitBranch(root, mainBranch);
  const msg = checkMessage(message);
  const files = await selectPaths(root, paths);
  const outside = files.filter((p) => !isDocPath(p));
  if (outside.length) {
    fail('not-docs-only', 'Only buggy documents can be committed without consent. Use commit-plan / commit-do.', { outside });
  }
  const commit = await commitWithMessage(root, files, msg);
  return { commit, branch, files };
}
