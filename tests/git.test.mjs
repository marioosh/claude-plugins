import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, tempDir, gitIn, writeFile, GIT_ENV } from './helpers.mjs';
import * as g from '../plugins/buggy/scripts/lib/git.mjs';

// Library functions run in-process: isolate git config for the whole file.
Object.assign(process.env, GIT_ENV);

async function code(fn) {
  try {
    await fn();
  } catch (e) {
    return e.code;
  }
  return 'no-error';
}

test('repoRoot and currentBranch', async (t) => {
  const dir = tempRepo(t);
  assert.ok(await g.repoRoot(dir));
  assert.equal(await g.currentBranch(dir), 'main');
  assert.equal(await g.repoRoot(tempDir(t)), null);
});

test('status and isClean, including untracked files and spaces in names', async (t) => {
  const dir = tempRepo(t);
  assert.equal(await g.isClean(dir), true);
  writeFile(dir, 'a file.md', 'x');
  const st = await g.status(dir);
  assert.deepEqual(st, [{ x: '?', y: '?', path: 'a file.md' }]);
  assert.equal(await g.isClean(dir), false);
});

test('switchCreate from main; refuses existing, missing base and invalid names', async (t) => {
  const dir = tempRepo(t);
  await g.switchCreate(dir, 'feature/20261119-x', 'main');
  assert.equal(await g.currentBranch(dir), 'feature/20261119-x');
  assert.equal(await code(() => g.switchCreate(dir, 'feature/20261119-x', 'main')), 'branch-exists');
  assert.equal(await code(() => g.switchCreate(dir, 'feature/y', 'nope')), 'branch-missing');
  assert.equal(await code(() => g.switchCreate(dir, '-x', 'main')), 'bad-branch');
  assert.equal(await code(() => g.switchCreate(dir, 'a..b', 'main')), 'bad-branch');
});

test('shell metacharacters in a branch name are never executed', async (t) => {
  const dir = tempRepo(t);
  const marker = join(dir, 'pwned');
  const evil = `x;touch ${marker}`;
  await code(() => g.switchCreate(dir, evil, 'main'));
  await code(() => g.switchCreate(dir, `$(touch ${marker})`, 'main'));
  assert.equal(existsSync(marker), false);
});

test('show reads a file at a ref, null when missing', async (t) => {
  const dir = tempRepo(t);
  assert.equal(await g.show(dir, 'main', 'README.md'), '# test');
  assert.equal(await g.show(dir, 'main', 'nope.txt'), null);
  assert.equal(await g.show(dir, 'nope', 'README.md'), null);
});

test('commitPaths commits only the given paths with a message from a file', async (t) => {
  const dir = tempRepo(t);
  writeFile(dir, 'a.md', 'a');
  writeFile(dir, 'b.md', 'b');
  const msg = join(tempDir(t), 'msg.txt');
  writeFileSync(msg, 'docs: add a\n\n"quoted" $(not run) `nope`\n');
  await g.commitPaths(dir, ['a.md'], msg);
  assert.equal(gitIn(dir, ['log', '-1', '--format=%B']).trim(), 'docs: add a\n\n"quoted" $(not run) `nope`');
  assert.deepEqual(await g.status(dir), [{ x: '?', y: '?', path: 'b.md' }]);
});

test('a path that looks like an option is treated as a path', async (t) => {
  const dir = tempRepo(t);
  writeFile(dir, '--force', 'x');
  await g.add(dir, ['--force']);
  assert.deepEqual(await g.stagedPaths(dir), ['--force']);
});

test('versionTags sorts by version and ignores other tags; tagCommit', async (t) => {
  const dir = tempRepo(t);
  for (const tag of ['v0.9.0', 'v0.10.0', 'v0.2.1', 'buggy-init', 'vX']) gitIn(dir, ['tag', tag]);
  assert.deepEqual(await g.versionTags(dir), ['v0.10.0', 'v0.9.0', 'v0.2.1']);
  assert.equal(await g.tagCommit(dir, 'v0.9.0'), gitIn(dir, ['rev-parse', 'HEAD']));
  assert.equal(await g.tagCommit(dir, 'v9.9.9'), null);
});

test('mv and hashObject', async (t) => {
  const dir = tempRepo(t);
  writeFile(dir, 'changes/x/spec.md', 'spec');
  gitIn(dir, ['add', '.']);
  gitIn(dir, ['commit', '-q', '-m', 'x']);
  await g.mv(dir, 'changes/x', 'releases-x');
  assert.ok(existsSync(join(dir, 'releases-x', 'spec.md')));
  assert.match(await g.hashObject(dir, 'releases-x/spec.md'), /^[0-9a-f]{40,64}$/);
});

test('status never reports model input files in .buggy/.tmp/', async (t) => {
  const dir = tempRepo(t);
  writeFile(dir, '.buggy/.tmp/x.json', '{}');
  assert.equal(await g.isClean(dir), true);
});
