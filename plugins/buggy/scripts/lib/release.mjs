// /buggy:release – which released version to publish, and a temporary
// worktree when the current checkout is not exactly that version (D-13, stage 7 P2–P3).

import { fail } from './cli.mjs';
import { ensureDir, resolveInside } from './fsutil.mjs';
import { git, versionTags, tagCommit, headCommit, status } from './git.mjs';
import { isValid as isVersion } from './semver.mjs';

export const worktreePath = (version) => `.buggy/.tmp/release-v${version}`;

const isAncestor = async (root, a, b) => (await git(['merge-base', '--is-ancestor', a, b], { cwd: root, allowFail: true })) !== null;

export async function target(root, config, wanted) {
  const main = config.mainBranch;
  let version = wanted;
  if (!wanted || wanted === 'latest') {
    version = null;
    for (const tag of await versionTags(root)) {
      if (await isAncestor(root, await tagCommit(root, tag), main)) {
        version = tag.slice(1);
        break;
      }
    }
    if (!version) fail('no-release', `No version tag vX.Y.Z on ${main} yet – ship a change first.`);
  }
  if (!isVersion(version)) fail('bad-version', `Not a version (X.Y.Z or latest): ${wanted}`);
  const tag = `v${version}`;
  const commit = await tagCommit(root, tag);
  if (!commit) fail('tag-missing', `Tag ${tag} does not exist.`);
  const onMain = await isAncestor(root, commit, main);
  const head = await headCommit(root);
  const clean = (await status(root)).length === 0;
  const files = ((await git(['ls-tree', '--name-only', '-r', tag, '--', 'releases/'], { cwd: root, allowFail: true })) ?? '').split('\n');
  const note = files.find((f) => f.startsWith(`releases/${version}-`) && f.endsWith('/release-note.md')) ?? null;
  return {
    version,
    tag,
    commit,
    onMain,
    releaseNote: note,
    releaseFolder: note ? note.slice(0, note.lastIndexOf('/')) : null,
    worktreeNeeded: head !== commit || !clean,
    worktree: worktreePath(version),
  };
}

export async function worktreeAdd(root, version) {
  if (!isVersion(version)) fail('bad-version', `Not a version (X.Y.Z): ${version}`);
  const tag = `v${version}`;
  if (!(await tagCommit(root, tag))) fail('tag-missing', `Tag ${tag} does not exist.`);
  const rel = worktreePath(version);
  ensureDir(root, '.buggy/.tmp');
  const abs = resolveInside(root, rel);
  await git(['worktree', 'add', '--detach', abs, tag], { cwd: root });
  return { path: rel, tag };
}

// Removes only a worktree that buggy created in .buggy/.tmp/.
export async function worktreeRemove(root, version) {
  if (!isVersion(version)) fail('bad-version', `Not a version (X.Y.Z): ${version}`);
  const rel = worktreePath(version);
  const abs = resolveInside(root, rel);
  const list = await git(['worktree', 'list', '--porcelain'], { cwd: root });
  const known = list.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9));
  if (!known.includes(abs)) fail('no-worktree', `No buggy worktree for ${version} (${rel}).`);
  await git(['worktree', 'remove', '--force', abs], { cwd: root });
  return { removed: rel };
}
