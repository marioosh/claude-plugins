// /buggy:ship – synchronisation with the main branch, release preparation and
// verification after the user's merge (D-1, D-2, D-3, D-37, stage 5 P4–P9).

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fail } from './cli.mjs';
import { exists, writeText, listDir, readText } from './fsutil.mjs';
import { git, status, currentBranch, hashObject, mv, tagCommit } from './git.mjs';
import { loadChange, setStatus, idFromBranch, branchFor, changeDir } from './change.mjs';
import { mainVersion, writeVersion } from './version.mjs';
import { bump } from './semver.mjs';
import { renderTemplate } from './templates.mjs';
import { todayIso } from './ids.mjs';
import { splitFrontmatter } from './yaml.mjs';

const execFileP = promisify(execFile);
const token = (data) => createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);

async function onChangeBranch(root) {
  const branch = await currentBranch(root);
  const id = idFromBranch(branch);
  if (!id) fail('no-change', `Not on a change branch (feature/<id>); current: ${branch ?? 'detached HEAD'}.`);
  return { branch, id };
}

const behindBy = async (root, main) => Number(await git(['rev-list', '--count', `HEAD..${main}`], { cwd: root }));
const mergeInProgress = async (root) =>
  (await git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: root, allowFail: true })) !== null;

// ---------- sync with the main branch (merge, through preview + token) ----------

export async function syncPlan(root, main) {
  const { branch } = await onChangeBranch(root);
  if (await mergeInProgress(root)) fail('merge-in-progress', 'A merge is in progress – resolve it (sync-continue-plan).');
  if ((await status(root)).length) fail('dirty-tree', 'Commit or put aside the uncommitted changes before syncing.');
  const behind = await behindBy(root, main);
  if (behind === 0) return { branch, main, behind: 0, upToDate: true, token: null };
  const files = (await git(['diff', '--name-only', `HEAD...${main}`], { cwd: root })).split('\n').filter(Boolean);
  const head = await git(['rev-parse', 'HEAD'], { cwd: root });
  const mainSha = await git(['rev-parse', main], { cwd: root });
  return { branch, main, behind, upToDate: false, files, token: token({ op: 'sync', head, mainSha, branch }) };
}

export async function syncDo(root, main, tok) {
  const plan = await syncPlan(root, main);
  if (plan.upToDate) return { merged: false, upToDate: true };
  if (plan.token !== tok) fail('token-mismatch', 'Something changed since the preview. Show the preview again and ask the user.');
  try {
    await execFileP('git', ['merge', '--no-ff', '--no-edit', main], { cwd: root });
  } catch (err) {
    if (await mergeInProgress(root)) {
      const conflicts = (await git(['diff', '--name-only', '--diff-filter=U'], { cwd: root })).split('\n').filter(Boolean);
      return { merged: false, conflicts };
    }
    fail('git-failed', `git merge failed: ${(err.stderr || err.message).trim()}`);
  }
  return { merged: true, commit: await git(['rev-parse', 'HEAD'], { cwd: root }) };
}

export async function syncContinuePlan(root) {
  const { branch } = await onChangeBranch(root);
  if (!(await mergeInProgress(root))) fail('no-merge', 'No merge in progress.');
  const unresolved = (await git(['diff', '--name-only', '--diff-filter=U'], { cwd: root })).split('\n').filter(Boolean);
  if (unresolved.length) fail('conflicts-left', 'Some files still have conflicts.', { files: unresolved });
  const files = [];
  for (const e of await status(root)) {
    files.push({ path: e.path, blob: existsSync(join(root, e.path)) ? await hashObject(root, e.path) : 'deleted' });
  }
  const head = await git(['rev-parse', 'HEAD'], { cwd: root });
  const mergeHead = await git(['rev-parse', 'MERGE_HEAD'], { cwd: root });
  return { branch, files: files.map((f) => f.path), token: token({ op: 'sync-continue', head, mergeHead, files }) };
}

export async function syncContinueDo(root, tok) {
  const plan = await syncContinuePlan(root);
  if (plan.token !== tok) fail('token-mismatch', 'Something changed since the preview. Show the preview again and ask the user.');
  if (plan.files.length) await git(['add', '--', ...plan.files], { cwd: root });
  await git(['commit', '--quiet', '--no-edit'], { cwd: root });
  return { merged: true, commit: await git(['rev-parse', 'HEAD'], { cwd: root }) };
}

// ---------- prepare the release (no commit) ----------

const list = (items, empty) => {
  if (items === undefined || items === null) return empty;
  if (!Array.isArray(items) || items.some((x) => typeof x !== 'string')) fail('bad-input', 'Lists must be lists of strings.');
  return items.length ? items.map((x) => `- ${x.trim()}`).join('\n') : empty;
};

export async function prepare(root, config, input = {}) {
  const { id } = await onChangeBranch(root);
  const change = loadChange(root, id);
  if (change.meta.status !== 'approved') fail('bad-status', `Shipping needs status approved (now: ${change.meta.status}).`);
  if (await mergeInProgress(root)) fail('merge-in-progress', 'A merge is in progress.');
  if ((await status(root)).length) fail('dirty-tree', 'Commit the remaining changes before shipping.');
  const main = config.mainBranch;
  const behind = await behindBy(root, main);
  if (behind) fail('behind-main', `${main} has ${behind} commit(s) this branch does not have – sync first.`, { behind });

  const base = await mainVersion(root, config);
  const version = bump(base, change.meta.change);
  if (await tagCommit(root, `v${version}`)) fail('version-taken', `Tag v${version} already exists.`);
  const slug = id.replace(/^\d{8}-/, '');
  const folder = `releases/${version}-${slug}`;
  if (listDir(root, 'releases', { dirs: true }).some((d) => d.startsWith(`${version}-`))) {
    fail('version-taken', `releases/ already has a folder for ${version}.`);
  }
  if (typeof input.summary !== 'string' || input.summary.trim() === '') fail('bad-input', 'summary is required.');
  const note = renderTemplate(root, 'release-note.md', {
    version,
    date: todayIso(),
    title: (input.title ?? change.meta.title).trim(),
    change: change.meta.change,
    id,
    summary: input.summary.trim(),
    changes: list(input.changes, '–'),
    migration: list(input.migration, 'None.'),
    limitations: list(input.limitations, 'None known.'),
  }).text;

  writeVersion(root, config, version);
  setStatus(root, id, 'shipped', { version });
  await mv(root, changeDir(id), folder);
  writeText(root, `${folder}/release-note.md`, note, { exclusive: true });
  const paths = (await status(root)).map((e) => e.path);
  return { id, version, previous: base, tag: `v${version}`, folder, versionFile: config.version.file, paths };
}

// ---------- verify after the user's merge ----------

export async function verify(root, config) {
  const problems = [];
  const main = config.mainBranch;
  const branch = await currentBranch(root);
  const version = await mainVersion(root, config);
  if (branch !== main) problems.push(`Run the verification on ${main} after merging (current branch: ${branch}).`);
  if (version === '0.0.0') return { ok: problems.length === 0, version, released: false, problems };
  const tag = `v${version}`;
  const tagged = await tagCommit(root, tag);
  const mainHead = await git(['rev-parse', main], { cwd: root });
  if (!tagged) problems.push(`Tag ${tag} is missing (hooks off, or merged on a server without a local git pull).`);
  else {
    const ancestor = await git(['merge-base', '--is-ancestor', tagged, mainHead], { cwd: root, allowFail: true });
    if (ancestor === null) problems.push(`Tag ${tag} points to a commit that is not in ${main}.`);
  }
  const folders = (await git(['ls-tree', '--name-only', main, 'releases/'], { cwd: root, allowFail: true }) ?? '')
    .split('\n')
    .filter((p) => p.startsWith(`releases/${version}-`));
  if (!folders.length) problems.push(`${main} has no releases/${version}-… folder.`);
  else {
    const spec = await git(['show', `${main}:${folders[0]}/spec.md`], { cwd: root, allowFail: true });
    const meta = spec ? splitFrontmatter(`${spec}\n`).data : null;
    if (!meta || meta.status !== 'shipped' || meta.version !== version) {
      problems.push(`${folders[0]}/spec.md is not marked shipped as ${version}.`);
    }
  }
  return { ok: problems.length === 0, version, tag, tagged: Boolean(tagged), release: folders[0] ?? null, released: true, problems };
}
