import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, gitIn, writeFile, runScript } from './helpers.mjs';

let k = 0;
const input = (dir, obj) => writeFile(dir, `.buggy/.tmp/i-${k++}.json`, JSON.stringify(obj));
const sh = (dir, script, args, obj) => runScript(script, obj ? [...args, '--input', input(dir, obj)] : args, { cwd: dir });
const tags = (dir) => gitIn(dir, ['tag', '--list']).split('\n').filter(Boolean).sort();

const REVIEW = '# R\n\n## Round 1\n\n- **Type:** final\n- **Diff:** `abc1234` → working tree (1 file)\n- **Checkpoint:** `def5678`\n\n| # | Source | Severity | Finding | Location | Decision | Status |\n|---|---|---|---|---|---|---|\n';

// Project on main (hooks installed, v0.6.4 tagged) with an approved change "Feature A" on its branch.
function approved(t, { json = false, hooks = true } = {}) {
  const dir = tempRepo(t);
  writeFile(dir, '.buggy/config.yaml', json ? 'buggy: 1\nversion:\n  file: package.json\n' : 'buggy: 1\n');
  writeFile(dir, '.buggy/.gitignore', '.tmp/\n');
  if (json) writeFile(dir, 'package.json', '{\n  "name": "x",\n  "version": "0.6.4"\n}\n');
  else writeFile(dir, 'version.txt', '0.6.4\n');
  writeFile(dir, 'src/a.js', 'export const a = 1;\n');
  if (hooks) sh(dir, 'githooks', ['install', '--mode', 'fresh']);
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['commit', '-q', '-m', 'setup']);
  const id = sh(dir, 'git', ['branch-new'], { title: 'Feature A' }).json.id;
  sh(dir, 'change', ['create', '--id', id], { title: 'Feature A' });
  writeFile(dir, `changes/${id}/plan.md`, '## Steps\n\n- [x] S1. Change a\n');
  writeFile(dir, `changes/${id}/review.md`, REVIEW);
  writeFile(dir, 'src/a.js', 'export const a = 2;\n');
  for (const s of ['clarified', 'planned', 'implementing', 'implemented', 'in-review', 'approved']) {
    assert.equal(sh(dir, 'change', ['set-status', '--to', s]).code, 0, s);
  }
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['commit', '-q', '-m', 'feat: a = 2']);
  return { dir, id };
}

const NOTE = { summary: 'Feature A is here.', changes: ['`a` is now 2.'], limitations: [] };

function commitRelease(dir, prep) {
  const req = { message: `release: v${prep.version} – Feature A`, paths: prep.paths };
  const plan = sh(dir, 'git', ['commit-plan'], req);
  assert.equal(plan.code, 0, plan.stdout);
  const done = sh(dir, 'git', ['commit-do', '--token', plan.json.token], req);
  assert.equal(done.code, 0, done.stdout);
}

test('ship end to end: prepare → commit → user merge → tag from the hook → verify', (t) => {
  const { dir, id } = approved(t);
  const prep = sh(dir, 'ship', ['prepare'], NOTE);
  assert.equal(prep.code, 0, prep.stdout);
  assert.equal(prep.json.version, '0.7.0');
  assert.equal(prep.json.previous, '0.6.4');
  assert.equal(prep.json.folder, 'releases/0.7.0-feature-a');
  assert.equal(readFileSync(join(dir, 'version.txt'), 'utf8'), '0.7.0\n');
  assert.equal(existsSync(join(dir, 'changes', id)), false);
  const spec = readFileSync(join(dir, 'releases/0.7.0-feature-a/spec.md'), 'utf8');
  assert.match(spec, /^status: shipped$/m);
  assert.match(spec, /^version: 0\.7\.0$/m);
  const note = readFileSync(join(dir, 'releases/0.7.0-feature-a/release-note.md'), 'utf8');
  assert.match(note, /^# 0\.7\.0 — \d{4}-\d{2}-\d{2} — Feature A\n/);
  assert.match(note, /## Changes\n\n- `a` is now 2\.\n/);
  assert.match(note, /## Known limitations\n\nNone known\./);

  commitRelease(dir, prep);
  assert.equal(gitIn(dir, ['status', '--porcelain']), '');
  const st = sh(dir, 'state', []).json;
  assert.deepEqual(st.warnings, []);
  assert.equal(st.change.status, 'shipped');
  assert.equal(st.change.version, '0.7.0');
  assert.match(st.change.next, /^merge feature\/.+ into main \(the user does it\), then \/buggy:ship on main$/);
  assert.ok(!tags(dir).includes('v0.7.0'), 'no tag on the change branch');
  const follow = gitIn(dir, ['log', '--follow', '--format=%s', '--', 'releases/0.7.0-feature-a/spec.md']).split('\n');
  assert.ok(follow.length >= 2, 'spec history follows the move');

  // the user merges
  gitIn(dir, ['switch', '-q', 'main']);
  gitIn(dir, ['merge', '-q', '--no-ff', '--no-edit', `feature/${id}`]);
  assert.ok(tags(dir).includes('v0.7.0'));
  assert.equal(gitIn(dir, ['tag', '-l', '--format=%(contents:subject)', 'v0.7.0']).split(' — ')[2], 'Feature A');
  const v = sh(dir, 'ship', ['verify']).json;
  assert.equal(v.ok, true, JSON.stringify(v.problems));
  assert.equal(v.release, 'releases/0.7.0-feature-a');
});

test('prepare refuses: not approved, dirty tree, behind main, version already tagged', (t) => {
  const { dir } = approved(t);
  writeFile(dir, 'wip.txt', 'x');
  assert.equal(sh(dir, 'ship', ['prepare'], NOTE).json.code, 'dirty-tree');
  gitIn(dir, ['stash', '-q', '-u']);
  gitIn(dir, ['tag', 'v0.7.0']);
  assert.equal(sh(dir, 'ship', ['prepare'], NOTE).json.code, 'version-taken');
  gitIn(dir, ['tag', '-d', 'v0.7.0']);
  const branch = gitIn(dir, ['branch', '--show-current']);
  gitIn(dir, ['switch', '-q', 'main']);
  writeFile(dir, 'other.txt', 'released meanwhile');
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['commit', '-q', '-m', 'other']);
  gitIn(dir, ['switch', '-q', branch]);
  assert.equal(sh(dir, 'ship', ['prepare'], NOTE).json.code, 'behind-main');
  assert.equal(sh(dir, 'ship', ['prepare'], { changes: [] }).json.code, 'behind-main');
  sh(dir, 'change', ['set-status', '--to', 'in-review']);
  const r = sh(dir, 'ship', ['prepare'], NOTE);
  assert.equal(r.json.code, 'bad-status');
});

test('sync: merge main into the change branch through preview and token', (t) => {
  const { dir } = approved(t);
  assert.equal(sh(dir, 'ship', ['sync-plan']).json.upToDate, true);
  const branch = gitIn(dir, ['branch', '--show-current']);
  gitIn(dir, ['switch', '-q', 'main']);
  writeFile(dir, 'docs.md', 'meanwhile on main\n');
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['commit', '-q', '-m', 'docs on main']);
  gitIn(dir, ['switch', '-q', branch]);
  const plan = sh(dir, 'ship', ['sync-plan']).json;
  assert.equal(plan.behind, 1);
  assert.deepEqual(plan.files, ['docs.md']);
  assert.equal(sh(dir, 'ship', ['sync-do', '--token', 'bad']).json.code, 'token-mismatch');
  const done = sh(dir, 'ship', ['sync-do', '--token', plan.token]).json;
  assert.equal(done.merged, true);
  assert.equal(sh(dir, 'ship', ['sync-plan']).json.upToDate, true);
  assert.equal(sh(dir, 'ship', ['prepare'], NOTE).code, 0, 'now shippable');
});

test('sync with a conflict: listed, then resolved and committed through a second token', (t) => {
  const { dir } = approved(t);
  const branch = gitIn(dir, ['branch', '--show-current']);
  gitIn(dir, ['switch', '-q', 'main']);
  writeFile(dir, 'src/a.js', 'export const a = 3;\n');
  gitIn(dir, ['commit', '-q', '-am', 'a = 3 on main']);
  gitIn(dir, ['switch', '-q', branch]);
  const plan = sh(dir, 'ship', ['sync-plan']).json;
  const r = sh(dir, 'ship', ['sync-do', '--token', plan.token]).json;
  assert.equal(r.merged, false);
  assert.deepEqual(r.conflicts, ['src/a.js']);
  assert.equal(sh(dir, 'ship', ['sync-continue-plan']).json.code, 'conflicts-left');
  writeFile(dir, 'src/a.js', 'export const a = 2;\n'); // resolved
  gitIn(dir, ['add', 'src/a.js']);
  const cont = sh(dir, 'ship', ['sync-continue-plan']).json;
  assert.ok(cont.token);
  const done = sh(dir, 'ship', ['sync-continue-do', '--token', cont.token]).json;
  assert.equal(done.merged, true);
  assert.equal(gitIn(dir, ['status', '--porcelain']), '');
  assert.equal(sh(dir, 'ship', ['sync-plan']).json.upToDate, true);
});

test('JSON version file is bumped in place', (t) => {
  const { dir } = approved(t, { json: true });
  const prep = sh(dir, 'ship', ['prepare'], NOTE).json;
  assert.equal(prep.versionFile, 'package.json');
  assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), '{\n  "name": "x",\n  "version": "0.7.0"\n}\n');
});

test('verify reports a missing tag (hooks off) until tag-now', (t) => {
  const { dir, id } = approved(t);
  const prep = sh(dir, 'ship', ['prepare'], NOTE).json;
  commitRelease(dir, prep);
  gitIn(dir, ['switch', '-q', 'main']);
  gitIn(dir, ['config', '--unset', 'core.hooksPath']);
  gitIn(dir, ['merge', '-q', '--no-ff', '--no-edit', `feature/${id}`]);
  let v = sh(dir, 'ship', ['verify']).json;
  assert.equal(v.ok, false);
  assert.match(v.problems[0], /Tag v0\.7\.0 is missing/);
  sh(dir, 'githooks', ['tag-now']);
  v = sh(dir, 'ship', ['verify']).json;
  assert.equal(v.ok, true, JSON.stringify(v.problems));
});
