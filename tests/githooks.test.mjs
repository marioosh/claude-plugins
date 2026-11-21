import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, chmodSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tempRepo, tempDir, gitIn, writeFile, runScript, GIT_ENV } from './helpers.mjs';

// Repository on main with buggy config and a version file, nothing committed yet beyond "init".
function project(t, { version = '0.6.4', json = false } = {}) {
  const dir = tempRepo(t);
  writeFile(dir, '.buggy/config.yaml', json ? 'buggy: 1\nversion:\n  file: package.json\n' : 'buggy: 1\n');
  writeFile(dir, '.buggy/.gitignore', '.tmp/\n');
  if (json) writeFile(dir, 'package.json', `{\n  "name": "x",\n  "version": "${version}",\n  "dependencies": { "y": "1.2.3" }\n}\n`);
  else writeFile(dir, 'version.txt', `${version}\n`);
  return dir;
}
const install = (dir, mode = 'fresh') => runScript('githooks', ['install', '--mode', mode], { cwd: dir });
const tags = (dir) => gitIn(dir, ['tag', '--list']).split('\n').filter(Boolean).sort();
const tagMsg = (dir, tag) => gitIn(dir, ['tag', '-l', '--format=%(contents:subject)', tag]);
const tagCommit = (dir, tag) => gitIn(dir, ['rev-list', '-n', '1', tag]);
const head = (dir) => gitIn(dir, ['rev-parse', 'HEAD']);
// git with stderr captured (hook messages)
const gitErr = (dir, args) => spawnSync('git', args, { cwd: dir, env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' });

function commitAll(dir, msg) {
  gitIn(dir, ['add', '-A']);
  return gitErr(dir, ['commit', '-q', '-m', msg]);
}

// A change branch that ships `version` with a release note, merged with `how`.
function shipOnBranch(dir, version, slug = 'feature') {
  gitIn(dir, ['switch', '-q', '-c', `feature/20261119-${slug}`]);
  writeFile(dir, 'version.txt', `${version}\n`);
  writeFile(dir, `releases/${version}-${slug}/release-note.md`, `# ${version} — 2026-11-19 — Nice ${slug}\n`);
  commitAll(dir, `release: v${version}`);
  gitIn(dir, ['switch', '-q', 'main']);
}

// ---------- install / check ----------

test('install fresh: script + hooks + core.hooksPath; check is green; idempotent', (t) => {
  const dir = project(t);
  const r = install(dir);
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(r.json.files, ['.githooks/buggy-tag.sh', '.githooks/post-merge', '.githooks/post-commit']);
  assert.equal(gitIn(dir, ['config', '--get', 'core.hooksPath']), '.githooks');
  assert.equal(r.json.check.installed, true, JSON.stringify(r.json.check.problems));
  assert.ok(statSync(join(dir, '.githooks/post-merge')).mode & 0o100);
  assert.match(readFileSync(join(dir, '.githooks/buggy-tag.sh'), 'utf8'), /^# buggy:config main=main file=version\.txt key=$/m);
  install(dir);
  assert.equal(readFileSync(join(dir, '.githooks/post-merge'), 'utf8').split('buggy-tag.sh').length - 1, 1, 'no duplicate call');
});

test('install fresh refuses when other hooks are active or hooksPath points elsewhere; append keeps them', (t) => {
  const dir = project(t);
  writeFileSync(join(dir, '.git/hooks/post-merge'), '#!/bin/sh\necho "lint after merge"\n');
  chmodSync(join(dir, '.git/hooks/post-merge'), 0o755);
  assert.equal(install(dir).json.code, 'hooks-active');
  const r = install(dir, 'append');
  assert.equal(r.code, 0, r.stdout);
  const pm = readFileSync(join(dir, '.git/hooks/post-merge'), 'utf8');
  assert.match(pm, /^#!\/bin\/sh\necho "lint after merge"\nsh "\$\(git rev-parse --show-toplevel\)\/\.githooks\/buggy-tag\.sh" \|\| true # buggy\n$/);
  assert.equal(r.json.check.installed, true, JSON.stringify(r.json.check.problems));

  const other = project(t);
  mkdirSync(join(other, '.husky'));
  gitIn(other, ['config', 'core.hooksPath', '.husky']);
  assert.equal(install(other).json.code, 'hooks-path-set');
  assert.equal(install(other, 'append').code, 0);
  assert.ok(readFileSync(join(other, '.husky/post-commit'), 'utf8').includes('.githooks/buggy-tag.sh'));
  assert.deepEqual(runScript('githooks', ['check'], { cwd: other }).json.managers, ['.husky']);
});

test('check reports a script that no longer matches the config', (t) => {
  const dir = project(t);
  install(dir);
  writeFile(dir, '.buggy/config.yaml', 'buggy: 1\nmain_branch: trunk\n');
  const c = runScript('githooks', ['check'], { cwd: dir }).json;
  assert.equal(c.installed, false);
  assert.match(c.problems[0], /does not match \.buggy\/config\.yaml/);
});

// ---------- tagging ----------

test('first commit on main with buggy: version tag and buggy-init', (t) => {
  const dir = project(t);
  install(dir);
  const r = commitAll(dir, 'chore: buggy setup');
  assert.match(r.stdout + r.stderr, /created tag v0\.6\.4/); // git sends hook output to stderr
  assert.deepEqual(tags(dir), ['buggy-init', 'v0.6.4']);
  assert.equal(tagMsg(dir, 'v0.6.4'), 'Version 0.6.4');
  assert.equal(tagCommit(dir, 'buggy-init'), head(dir));
});

test('no tags on a change branch; merge --no-ff into main tags the merge with the release note title', (t) => {
  const dir = project(t);
  install(dir);
  commitAll(dir, 'setup');
  shipOnBranch(dir, '0.7.0');
  assert.deepEqual(tags(dir), ['buggy-init', 'v0.6.4'], 'the commit on the branch made no tag');
  gitIn(dir, ['merge', '-q', '--no-ff', '--no-edit', 'feature/20261119-feature']);
  assert.deepEqual(tags(dir), ['buggy-init', 'v0.6.4', 'v0.7.0']);
  assert.equal(tagCommit(dir, 'v0.7.0'), head(dir));
  assert.equal(tagMsg(dir, 'v0.7.0'), '0.7.0 — 2026-11-19 — Nice feature');
});

test('fast-forward and squash merges are tagged too', (t) => {
  const dir = project(t);
  install(dir);
  commitAll(dir, 'setup');
  shipOnBranch(dir, '0.7.0', 'ff');
  gitIn(dir, ['merge', '-q', '--ff-only', 'feature/20261119-ff']);
  assert.ok(tags(dir).includes('v0.7.0'));
  shipOnBranch(dir, '0.8.0', 'sq');
  gitIn(dir, ['merge', '-q', '--squash', 'feature/20261119-sq']);
  gitIn(dir, ['commit', '-q', '-m', 'release: v0.8.0 (squash)']);
  assert.ok(tags(dir).includes('v0.8.0'));
  assert.equal(tagCommit(dir, 'v0.8.0'), head(dir));
});

test('merging something without a new version adds no tag and no warning', (t) => {
  const dir = project(t);
  install(dir);
  commitAll(dir, 'setup');
  gitIn(dir, ['switch', '-q', '-c', 'chore/20261119-docs']);
  writeFile(dir, 'README.md', 'more docs\n');
  commitAll(dir, 'docs');
  gitIn(dir, ['switch', '-q', 'main']);
  const r = gitErr(dir, ['merge', '-q', '--no-ff', '--no-edit', 'chore/20261119-docs']);
  assert.equal(r.stderr, '');
  assert.deepEqual(tags(dir), ['buggy-init', 'v0.6.4']);
});

test('a tag outside the history of main is reported and left alone', (t) => {
  const dir = project(t);
  install(dir);
  commitAll(dir, 'setup');
  gitIn(dir, ['switch', '-q', '-c', 'side']);
  writeFile(dir, 'x.txt', 'x');
  commitAll(dir, 'side');
  gitIn(dir, ['tag', '-a', 'v0.7.0', '-m', 'wrong place']);
  const wrong = head(dir);
  gitIn(dir, ['switch', '-q', 'main']);
  writeFile(dir, 'version.txt', '0.7.0\n');
  const r = commitAll(dir, 'release on main');
  assert.match(r.stderr, /tag v0\.7\.0 already exists on [0-9a-f]+, which is not in the history of main/);
  assert.equal(tagCommit(dir, 'v0.7.0'), wrong);
});

test('0.0.0 gets no tag but buggy-init; JSON version file; --print-version', async (t) => {
  const fresh = project(t, { version: '0.0.0' });
  install(fresh);
  commitAll(fresh, 'setup');
  assert.deepEqual(tags(fresh), ['buggy-init']);

  const js = project(t, { version: '1.2.3', json: true });
  install(js);
  commitAll(js, 'setup');
  assert.ok(tags(js).includes('v1.2.3'), 'reads "version", not the dependency "1.2.3" by accident');
  const { hookVersion } = await import('../plugins/buggy/scripts/lib/githooks.mjs');
  assert.equal(await hookVersion(js), '1.2.3');
});

test('git pull in a clone tags the merged version (merge made elsewhere, e.g. on GitHub)', (t) => {
  const origin = project(t);
  install(origin);
  commitAll(origin, 'setup');
  gitIn(origin, ['config', '--unset', 'core.hooksPath']); // "GitHub": no local hooks there
  const clone = join(tempDir(t), 'clone');
  gitIn(origin, ['clone', '-q', origin, clone]);
  gitIn(clone, ['config', 'core.hooksPath', '.githooks']); // hooks are per clone (doctor checks this)
  shipOnBranch(origin, '0.7.0');
  gitIn(origin, ['merge', '-q', '--no-ff', '--no-edit', 'feature/20261119-feature']);
  assert.ok(!tags(origin).includes('v0.7.0'), 'no hooks in origin');
  gitIn(clone, ['pull', '-q', '--ff-only']);
  assert.ok(tags(clone).includes('v0.7.0'));
});

test('tag-now runs the same logic on demand', (t) => {
  const dir = project(t);
  install(dir);
  gitIn(dir, ['config', '--unset', 'core.hooksPath']);
  commitAll(dir, 'setup (hooks were off)');
  assert.deepEqual(tags(dir), []);
  const r = runScript('githooks', ['tag-now'], { cwd: dir });
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.json.output, /created tag v0\.6\.4/);
  assert.deepEqual(tags(dir), ['buggy-init', 'v0.6.4']);
});

test('state warns while the hooks are not installed in this clone', (t) => {
  const dir = project(t);
  commitAll(dir, 'setup');
  const warn = (d) => runScript('state', [], { cwd: d }).json.warnings.some((w) => w.includes('git hooks are not installed'));
  assert.equal(warn(dir), true);
  install(dir);
  assert.equal(warn(dir), false);
});

test('buggy-tag.sh and helper scripts in the hooks directory are not counted as active hooks', (t) => {
  const dir = project(t);
  assert.equal(install(dir).code, 0);
  writeFileSync(join(dir, '.githooks/helper.sh'), '#!/bin/sh\n');
  chmodSync(join(dir, '.githooks/helper.sh'), 0o755);
  const c = runScript('githooks', ['check'], { cwd: dir }).json;
  assert.deepEqual(c.otherActiveHooks, []);
  writeFileSync(join(dir, '.githooks/pre-push'), '#!/bin/sh\n');
  chmodSync(join(dir, '.githooks/pre-push'), 0o755);
  assert.deepEqual(runScript('githooks', ['check'], { cwd: dir }).json.otherActiveHooks, ['pre-push']);
});
