import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir, tempRepo, runScript, writeFile, gitIn } from './helpers.mjs';

test('state outside a git repository: ok, git false, exit 0', (t) => {
  const dir = tempDir(t);
  const r = runScript('state', [], { cwd: dir });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.status, 'ok');
  assert.equal(r.json.git, false);
  assert.equal(r.json.buggy, false);
});

test('state in a git repository without buggy', (t) => {
  const dir = tempRepo(t);
  const r = runScript('state', [], { cwd: dir });
  assert.equal(r.code, 0);
  assert.equal(r.json.git, true);
  assert.equal(r.json.buggy, false);
  assert.equal(r.json.branch, 'main');
  assert.equal(realpathSync(r.json.root), realpathSync(dir));
});

test('state detects .buggy/config.yaml', (t) => {
  const dir = tempRepo(t);
  writeFile(dir, '.buggy/config.yaml', 'buggy: 1\n');
  const r = runScript('state', [], { cwd: dir });
  assert.equal(r.json.buggy, true);
});

test('run.sh rejects unknown and unsafe script names with JSON, exit 0', (t) => {
  const dir = tempDir(t);
  for (const name of ['nope', '../state', 'state;ls', '']) {
    const r = runScript(name, [], { cwd: dir });
    assert.equal(r.code, 0, `name=${name}`);
    assert.equal(r.json.code, 'bad-script', `name=${name}`);
  }
});

// ---------- full state (S12) ----------


function buggyRepo(t, version = '0.6.4\n') {
  const dir = tempRepo(t);
  writeFile(dir, '.buggy/config.yaml', 'buggy: 1\nlanguage:\n  docs: pl\n');
  if (version !== null) writeFile(dir, 'version.txt', version);
  gitIn(dir, ['add', '.']);
  gitIn(dir, ['commit', '-q', '-m', 'setup']);
  return dir;
}

function startChange(t, dir, title = 'Club meetings') {
  const input = join(tempDir(t), 'in.json');
  writeFileSync(input, JSON.stringify({ title, change: 'minor' }));
  const b = runScript('git', ['branch-new', '--input', input], { cwd: dir });
  runScript('change', ['create', '--id', b.json.id, '--input', input], { cwd: dir });
  return b.json.id;
}

function specText(dir, id) {
  return readFileSync(join(dir, 'changes', id, 'spec.md'), 'utf8');
}

test('state on main of a buggy project: versions, tag warning, no current change', (t) => {
  const dir = buggyRepo(t);
  const s = runScript('state', [], { cwd: dir }).json;
  assert.equal(s.buggy, true);
  assert.equal(s.mainBranch, 'main');
  assert.equal(s.language.docs, 'pl');
  assert.equal(s.version.main, '0.6.4');
  assert.equal(s.version.mainTagged, false);
  assert.ok(s.warnings.some((w) => w.includes('has no tag v0.6.4')));
  assert.equal(s.change, null);
  gitIn(dir, ['tag', 'v0.6.4']);
  assert.equal(runScript('state', [], { cwd: dir }).json.version.mainTagged, true);
});

test('state on a change branch: current change, next command, wouldBe version', (t) => {
  const dir = buggyRepo(t);
  const id = startChange(t, dir);
  const s = runScript('state', [], { cwd: dir }).json;
  assert.equal(s.change.id, id);
  assert.equal(s.change.status, 'draft');
  assert.equal(s.change.next, '/buggy:clarify');
  assert.equal(s.change.wouldBe, '0.7.0');
  assert.equal(s.change.mainMoved, false);
  assert.equal(s.changes.length, 1);
});

test('state: spec edited after clarify points back to clarify', (t) => {
  const dir = buggyRepo(t);
  const id = startChange(t, dir);
  runScript('change', ['set-status', '--to', 'clarified'], { cwd: dir });
  assert.equal(runScript('state', [], { cwd: dir }).json.change.next, '/buggy:plan');
  writeFile(dir, `changes/${id}/spec.md`, `${specText(dir, id)}\nMore.\n`);
  const s = runScript('state', [], { cwd: dir }).json;
  assert.equal(s.change.specChanged, true);
  assert.equal(s.change.next, '/buggy:clarify');
});


test('state: fresh project without a version file starts at 0.0.0', (t) => {
  const dir = buggyRepo(t, null);
  const s = runScript('state', [], { cwd: dir }).json;
  assert.equal(s.version.main, '0.0.0');
  assert.equal(s.version.workingTree, null);
  assert.ok(!s.warnings.some((w) => w.includes('has no tag')));
});

test('state never fails: broken config and broken change become warnings', (t) => {
  const dir = tempRepo(t);
  writeFile(dir, '.buggy/config.yaml', 'buggy: 7\n');
  let r = runScript('state', [], { cwd: dir });
  assert.equal(r.code, 0);
  assert.equal(r.json.status, 'ok');
  assert.equal(r.json.buggy, false);
  assert.ok(r.json.warnings.some((w) => w.includes('config')));

  const ok = buggyRepo(t);
  gitIn(ok, ['switch', '-q', '-c', 'feature/20261119-broken']);
  writeFile(ok, 'changes/20261119-broken/spec.md', 'no frontmatter');
  r = runScript('state', [], { cwd: ok });
  assert.equal(r.code, 0);
  assert.equal(r.json.change, null);
  assert.ok(r.json.warnings.some((w) => w.includes('20261119-broken')));
});

test('state: work already on the change branch (besides its documents) is listed', (t) => {
  const dir = buggyRepo(t);
  const id = startChange(t, dir);
  let s = runScript('state', [], { cwd: dir }).json;
  assert.deepEqual(s.change.branchWork, { commits: 0, files: [], filesCount: 0 });
  writeFile(dir, 'mix.lock', 'updated\n');
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['commit', '-q', '-m', 'deps']);
  s = runScript('state', [], { cwd: dir }).json;
  assert.deepEqual(s.change.branchWork, { commits: 1, files: ['mix.lock'], filesCount: 1 });
});
