import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, gitIn, writeFile, runScript } from './helpers.mjs';

const sh = (dir, script, args) => runScript(script, args, { cwd: dir });

// main with two releases: v0.1.0 (a = 1) and v0.2.0 (a = 2), plus a docs commit after v0.2.0.
function released(t) {
  const dir = tempRepo(t);
  writeFile(dir, '.buggy/config.yaml', 'buggy: 1\n');
  writeFile(dir, '.buggy/.gitignore', '.tmp/\n');
  writeFile(dir, 'version.txt', '0.1.0\n');
  writeFile(dir, 'src/a.js', 'export const a = 1;\n');
  writeFile(dir, 'releases/0.1.0-first/release-note.md', '# 0.1.0 — First\n');
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['commit', '-q', '-m', 'v0.1.0']);
  gitIn(dir, ['tag', '-a', 'v0.1.0', '-m', 'v0.1.0']);
  writeFile(dir, 'version.txt', '0.2.0\n');
  writeFile(dir, 'src/a.js', 'export const a = 2;\n');
  writeFile(dir, 'releases/0.2.0-second/release-note.md', '# 0.2.0 — Second\n');
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['commit', '-q', '-m', 'v0.2.0']);
  gitIn(dir, ['tag', '-a', 'v0.2.0', '-m', 'v0.2.0']);
  return dir;
}

test('target latest = newest tag on main; no worktree when HEAD is that tag and clean', (t) => {
  const dir = released(t);
  const r = sh(dir, 'release', ['target']).json;
  assert.equal(r.version, '0.2.0');
  assert.equal(r.onMain, true);
  assert.equal(r.releaseNote, 'releases/0.2.0-second/release-note.md');
  assert.equal(r.releaseFolder, 'releases/0.2.0-second');
  assert.equal(r.worktreeNeeded, false);
  writeFile(dir, 'wip.txt', 'x');
  assert.equal(sh(dir, 'release', ['target']).json.worktreeNeeded, true, 'dirty tree');
});

test('target: an older version needs a worktree; missing tag and bad input are errors', (t) => {
  const dir = released(t);
  const r = sh(dir, 'release', ['target', '--version', '0.1.0']).json;
  assert.equal(r.version, '0.1.0');
  assert.equal(r.worktreeNeeded, true);
  assert.equal(r.worktree, '.buggy/.tmp/release-v0.1.0');
  assert.equal(sh(dir, 'release', ['target', '--version', '9.9.9']).json.code, 'tag-missing');
  assert.equal(sh(dir, 'release', ['target', '--version', 'v1']).json.code, 'bad-version');
});

test('target latest ignores tags that are not on main', (t) => {
  const dir = released(t);
  gitIn(dir, ['switch', '-q', '-c', 'side']);
  writeFile(dir, 'x.txt', 'x');
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['commit', '-q', '-m', 'side']);
  gitIn(dir, ['tag', 'v9.0.0']);
  gitIn(dir, ['switch', '-q', 'main']);
  assert.equal(sh(dir, 'release', ['target']).json.version, '0.2.0');
  const r = sh(dir, 'release', ['target', '--version', '9.0.0']).json;
  assert.equal(r.onMain, false);
});

test('worktree add/remove: the code of the tag, in .buggy/.tmp, invisible to git status', (t) => {
  const dir = released(t);
  const add = sh(dir, 'release', ['worktree-add', '--version', '0.1.0']);
  assert.equal(add.code, 0, add.stdout);
  const wt = join(dir, add.json.path);
  assert.equal(readFileSync(join(wt, 'src/a.js'), 'utf8'), 'export const a = 1;\n');
  assert.equal(gitIn(dir, ['status', '--porcelain']), '', 'ignored by .buggy/.gitignore');
  writeFile(wt, 'dist/pkg.tgz', 'build output');
  const rm = sh(dir, 'release', ['worktree-remove', '--version', '0.1.0']);
  assert.equal(rm.code, 0, rm.stdout);
  assert.equal(existsSync(wt), false);
  assert.equal(sh(dir, 'release', ['worktree-remove', '--version', '0.1.0']).json.code, 'no-worktree');
  assert.equal(sh(dir, 'release', ['worktree-add', '--version', '7.7.7']).json.code, 'tag-missing');
});

test('knowledge init --name release and doctor context', (t) => {
  const dir = released(t);
  writeFile(dir, '.buggy/stack.md', '# Stack\n');
  writeFile(dir, 'package.json', '{}');
  writeFile(dir, 'CLAUDE.md', '# guide\n');
  writeFile(dir, 'releases/0.0.9-zero/spec.md', '---\nid: x\n---\n');
  writeFile(dir, 'releases/0.10.0-ten/spec.md', '---\nid: y\n---\n');
  const k = sh(dir, 'knowledge', ['init', '--name', 'release']).json;
  assert.equal(k.path, '.buggy/release.md');
  assert.match(readFileSync(join(dir, '.buggy/release.md'), 'utf8'), /\*\*\[outside\]\*\*/);
  const c = sh(dir, 'doctor', ['context']).json;
  assert.deepEqual(c.knowledge, ['.buggy/release.md', '.buggy/stack.md']);
  assert.deepEqual(c.manifests, ['package.json']);
  assert.deepEqual(c.claude, ['CLAUDE.md']);
  assert.deepEqual(c.releases.map((r) => r.version), ['0.10.0', '0.2.0', '0.1.0'], 'three newest, semver order');
  assert.deepEqual(c.releases[0].files, ['releases/0.10.0-ten/spec.md']);
});
