import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, tempDir, gitIn, writeFile, runScript, GIT_ENV } from './helpers.mjs';
import { mv } from '../plugins/buggy/scripts/lib/git.mjs';

Object.assign(process.env, GIT_ENV);

function buggyRepo(t) {
  const dir = tempRepo(t);
  writeFile(dir, '.buggy/config.yaml', 'buggy: 1\n');
  writeFile(dir, 'version.txt', '0.6.4\n');
  gitIn(dir, ['add', '.']);
  gitIn(dir, ['commit', '-q', '-m', 'setup']);
  return dir;
}

function input(t, obj) {
  const p = join(tempDir(t), 'in.json');
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

const git = (dir, args, t, obj) => runScript('git', [...args, '--input', input(t, obj)], { cwd: dir });
const log = (dir) => gitIn(dir, ['log', '--format=%s']).split('\n');

test('branch-new creates feature/<date>-<slug> from main', (t) => {
  const dir = buggyRepo(t);
  gitIn(dir, ['switch', '-q', '-c', 'other']);
  writeFile(dir, 'other.txt', 'x');
  gitIn(dir, ['add', '.']);
  gitIn(dir, ['commit', '-q', '-m', 'other work']);
  const r = git(dir, ['branch-new'], t, { title: 'Miejsca spotkań' });
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.json.id, /^\d{8}-miejsca-spotkan$/);
  assert.equal(gitIn(dir, ['branch', '--show-current']), r.json.branch);
  assert.deepEqual(log(dir), ['setup', 'init'], 'branched from main, not from the current branch');
});

test('branch-new refuses a dirty tree and lists the files', (t) => {
  const dir = buggyRepo(t);
  writeFile(dir, 'wip.txt', 'x');
  const r = git(dir, ['branch-new'], t, { title: 'X' });
  assert.equal(r.code, 1);
  assert.equal(r.json.code, 'dirty-tree');
  assert.deepEqual(r.json.details.files, ['wip.txt']);
});

test('commit-docs: buggy documents only, never on main', (t) => {
  const dir = buggyRepo(t);
  writeFile(dir, 'changes/20261119-x/spec.md', 'spec');
  let r = git(dir, ['commit-docs'], t, { message: 'docs: spec' });
  assert.equal(r.json.code, 'main-branch');
  gitIn(dir, ['switch', '-q', '-c', 'feature/20261119-x']);
  writeFile(dir, 'src/app.js', 'code');
  r = git(dir, ['commit-docs'], t, { message: 'docs: spec' });
  assert.equal(r.json.code, 'not-docs-only');
  assert.deepEqual(r.json.details.outside, ['src/app.js']);
  r = git(dir, ['commit-docs'], t, { message: 'docs: spec', paths: ['changes/20261119-x/spec.md'] });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(log(dir)[0], 'docs: spec');
  assert.deepEqual(gitIn(dir, ['status', '--porcelain']).split('\n'), ['?? src/'], 'code left uncommitted');
});

test('commit-docs commits a git mv from changes/ to releases/ as a whole', async (t) => {
  const dir = buggyRepo(t);
  gitIn(dir, ['switch', '-q', '-c', 'feature/20261119-x']);
  writeFile(dir, 'changes/20261119-x/spec.md', 'spec');
  gitIn(dir, ['add', '.']);
  gitIn(dir, ['commit', '-q', '-m', 'spec']);
  await mv(dir, 'changes/20261119-x', 'releases/0.7.0-x'); // creates releases/
  const r = git(dir, ['commit-docs'], t, { message: 'docs: release', paths: ['releases/0.7.0-x/spec.md'] });
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(r.json.files, ['changes/20261119-x/spec.md', 'releases/0.7.0-x/spec.md']);
  assert.equal(gitIn(dir, ['status', '--porcelain']), '');
});

test('commit-plan / commit-do: commits exactly what was previewed', (t) => {
  const dir = buggyRepo(t);
  gitIn(dir, ['switch', '-q', '-c', 'feature/20261119-x']);
  writeFile(dir, 'src/a.js', 'a');
  writeFile(dir, 'src/b.js', 'b');
  const req = { message: 'feat: a\n\nDetails "quoted" $(x)', paths: ['src/a.js'] };
  const plan = git(dir, ['commit-plan'], t, req);
  assert.equal(plan.code, 0, plan.stdout);
  assert.equal(plan.json.files.length, 1);
  assert.equal(log(dir)[0], 'setup', 'plan does not commit');
  const done = git(dir, ['commit-do', '--token', plan.json.token], t, req);
  assert.equal(done.code, 0, done.stdout);
  assert.equal(gitIn(dir, ['log', '-1', '--format=%B']).trim(), 'feat: a\n\nDetails "quoted" $(x)');
  assert.deepEqual(gitIn(dir, ['status', '--porcelain']).split('\n'), ['?? src/b.js']);
});

test('commit-do refuses when a file, the message or the path list changed after the preview', (t) => {
  const dir = buggyRepo(t);
  gitIn(dir, ['switch', '-q', '-c', 'feature/20261119-x']);
  writeFile(dir, 'src/a.js', 'a');
  writeFile(dir, 'src/b.js', 'b');
  const req = { message: 'feat: a', paths: ['src/a.js'] };
  const token = git(dir, ['commit-plan'], t, req).json.token;

  appendFileSync(join(dir, 'src/a.js'), 'changed');
  assert.equal(git(dir, ['commit-do', '--token', token], t, req).json.code, 'token-mismatch');

  const token2 = git(dir, ['commit-plan'], t, req).json.token;
  assert.equal(git(dir, ['commit-do', '--token', token2], t, { ...req, message: 'feat: other' }).json.code, 'token-mismatch');
  assert.equal(git(dir, ['commit-do', '--token', token2], t, { ...req, paths: ['src/a.js', 'src/b.js'] }).json.code, 'token-mismatch');
  assert.equal(log(dir)[0], 'setup');
});

test('commit-plan refuses main, unknown paths and paths outside the repository', (t) => {
  const dir = buggyRepo(t);
  writeFile(dir, 'src/a.js', 'a');
  assert.equal(git(dir, ['commit-plan'], t, { message: 'x', paths: ['src/a.js'] }).json.code, 'main-branch');
  gitIn(dir, ['switch', '-q', '-c', 'feature/20261119-x']);
  assert.equal(git(dir, ['commit-plan'], t, { message: 'x', paths: ['nope.js'] }).json.code, 'nothing-to-commit');
  assert.equal(git(dir, ['commit-plan'], t, { message: 'x', paths: ['../outside'] }).json.code, 'path-outside-repo');
  assert.equal(git(dir, ['commit-plan'], t, { message: ' ', paths: ['src/a.js'] }).json.code, 'bad-input');
});

test('git.mjs: missing --input and unknown command', (t) => {
  const dir = buggyRepo(t);
  assert.equal(runScript('git', ['commit-docs'], { cwd: dir }).json.code, 'bad-arguments');
  assert.equal(runScript('git', ['push', '--input', input(t, {})], { cwd: dir }).json.code, 'bad-arguments');
});

// ---------- branch-new modes (D-17) ----------

test('branch-new --mode stash: changes stashed, branch from main, restore hint', (t) => {
  const dir = buggyRepo(t);
  gitIn(dir, ['switch', '-q', '-c', 'feature/20261118-wip']);
  writeFile(dir, 'README.md', 'edited\n');
  writeFile(dir, 'new.txt', 'untracked');
  const r = git(dir, ['branch-new', '--mode', 'stash'], t, { title: 'Next thing' });
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(r.json.stashed.sort(), ['README.md', 'new.txt']);
  assert.equal(r.json.restore, 'git switch feature/20261118-wip && git stash pop');
  assert.equal(gitIn(dir, ['status', '--porcelain']), '');
  assert.match(gitIn(dir, ['stash', 'list']), /buggy: before \d{8}-next-thing \(from feature\/20261118-wip\)/);
  gitIn(dir, ['switch', '-q', 'feature/20261118-wip']);
  gitIn(dir, ['stash', 'pop', '-q']);
  assert.match(gitIn(dir, ['status', '--porcelain']), /README\.md/);
});

test('branch-new --mode carry: changes move to the new branch', (t) => {
  const dir = buggyRepo(t);
  writeFile(dir, 'notes.txt', 'belongs to the new change');
  const r = git(dir, ['branch-new', '--mode', 'carry'], t, { title: 'Carry me' });
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(r.json.carried, ['notes.txt']);
  assert.equal(gitIn(dir, ['branch', '--show-current']), r.json.branch);
  assert.equal(gitIn(dir, ['status', '--porcelain']), '?? notes.txt');
});

test('branch-new --mode carry: conflict with main changes nothing', (t) => {
  const dir = buggyRepo(t);
  gitIn(dir, ['switch', '-q', '-c', 'feature/20261118-wip']);
  writeFile(dir, 'README.md', 'branch version\n');
  gitIn(dir, ['commit', '-q', '-am', 'branch edit']);
  writeFile(dir, 'README.md', 'uncommitted edit\n');
  const r = git(dir, ['branch-new', '--mode', 'carry'], t, { title: 'Conflict' });
  assert.equal(r.code, 1);
  assert.equal(r.json.code, 'carry-conflict');
  assert.equal(gitIn(dir, ['branch', '--show-current']), 'feature/20261118-wip');
  assert.match(gitIn(dir, ['status', '--porcelain']), /README\.md/);
});

test('branch-new: clean tree ignores the mode; bad mode is an error', (t) => {
  const dir = buggyRepo(t);
  const r = git(dir, ['branch-new', '--mode', 'stash'], t, { title: 'Clean' });
  assert.equal(r.json.mode, 'clean');
  assert.equal(r.json.stashed, undefined);
  assert.equal(git(dir, ['branch-new', '--mode', 'yolo'], t, { title: 'X' }).json.code, 'bad-arguments');
});

test('branch-chore: chore/<date>-<slug> from main, unique', (t) => {
  const dir = buggyRepo(t);
  const a = git(dir, ['branch-chore'], t, { title: 'idea heatmap' });
  assert.equal(a.code, 0, a.stdout);
  assert.match(a.json.branch, /^chore\/\d{8}-idea-heatmap$/);
  gitIn(dir, ['switch', '-q', 'main']);
  const b = git(dir, ['branch-chore'], t, { title: 'idea heatmap' });
  assert.equal(b.json.branch, `${a.json.branch}-2`);
});

test('commit-plan / commit-docs accept a directory for every changed file under it', (t) => {
  const dir = buggyRepo(t);
  gitIn(dir, ['switch', '-q', '-c', 'feature/20261119-x']);
  writeFile(dir, '.buggy/project.md', 'p');
  writeFile(dir, '.buggy/stack.md', 's');
  writeFile(dir, 'src/a.js', 'a');
  const plan = git(dir, ['commit-plan'], t, { message: 'docs: knowledge', paths: ['.buggy/'] });
  assert.equal(plan.code, 0, plan.stdout);
  assert.deepEqual(plan.json.files.map((f) => f.path), ['.buggy/project.md', '.buggy/stack.md']);
  const docs = git(dir, ['commit-docs'], t, { message: 'docs: knowledge', paths: ['.buggy'] });
  assert.equal(docs.code, 0, docs.stdout);
  assert.deepEqual(docs.json.files, ['.buggy/project.md', '.buggy/stack.md']);
  assert.equal(git(dir, ['commit-docs'], t, { message: 'x', paths: ['docs/'] }).json.code, 'nothing-to-commit');
});
