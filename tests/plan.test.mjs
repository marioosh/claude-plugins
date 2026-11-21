import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, gitIn, writeFile, runScript } from './helpers.mjs';
import { checkSteps, parseSteps, progress } from '../plugins/buggy/scripts/lib/plan.mjs';

function setup(t) {
  const dir = tempRepo(t);
  writeFile(dir, '.buggy/config.yaml', 'buggy: 1\n');
  writeFile(dir, 'version.txt', '0.6.4\n');
  gitIn(dir, ['add', '.']);
  gitIn(dir, ['commit', '-q', '-m', 'setup']);
  const inp = writeFile(dir, '.buggy/.tmp/a.json', JSON.stringify({ title: 'Add sum function' }));
  const id = runScript('git', ['branch-new', '--input', inp], { cwd: dir }).json.id;
  runScript('change', ['create', '--id', id, '--input', writeFile(dir, '.buggy/.tmp/b.json', '{"title":"Add sum function"}')], { cwd: dir });
  return { dir, id, plan: join(dir, 'changes', id, 'plan.md'), history: join(dir, 'changes', id, 'history.md') };
}
let k = 0;
const input = (dir, obj) => writeFile(dir, `.buggy/.tmp/i-${k++}.json`, JSON.stringify(obj));
const sh = (dir, script, args, obj) => runScript(script, obj ? [...args, '--input', input(dir, obj)] : args, { cwd: dir });
const PLAN = (steps) => `# Plan\n\n## Goal\n\n- [ ] S9. not a step (outside Steps)\n\n## Steps\n\n${steps}\n\n## Notes\n\nx\n`;

// ---------- lib ----------

test('checkSteps: valid list, gaps, duplicates, empty text, missing section', () => {
  assert.equal(checkSteps(PLAN('- [ ] S1. A\n- [x] S2. B')).ok, true);
  assert.deepEqual(checkSteps(PLAN('- [ ] S1. A\n- [ ] S3. C')).problems, ['Step 2 is numbered S3 (expected S2).']);
  assert.equal(checkSteps(PLAN('- [ ] S1. A\n- [ ] S1. B')).ok, false);
  assert.deepEqual(checkSteps(PLAN('- [ ] S1.')).problems, ['Step S1 has no text.']);
  assert.equal(checkSteps('# Plan\n').problems[0], 'No "## Steps" section.');
  assert.equal(checkSteps('## Steps\n\ntext only\n').ok, false);
});

test('parseSteps ignores lookalike lines outside the Steps section; progress', () => {
  const text = PLAN('- [x] S1. A\n- [ ] S2. B');
  assert.deepEqual(parseSteps(text).steps.map((s) => s.n), [1, 2]);
  assert.deepEqual(progress(text), { done: 1, total: 2 });
});

// ---------- scripts ----------

test('plan init creates the plan once; check reports the empty template step', (t) => {
  const { dir, id, plan } = setup(t);
  let r = sh(dir, 'plan', ['init']);
  assert.equal(r.json.created, true);
  assert.match(readFileSync(plan, 'utf8'), /^# Add sum function – implementation plan/);
  assert.equal(sh(dir, 'plan', ['init']).json.created, false);
  r = sh(dir, 'plan', ['check']);
  assert.equal(r.json.ok, false);
  assert.deepEqual(r.json.problems, ['Step S1 has no text.']);
  assert.equal(sh(dir, 'plan', ['check', '--id', id]).json.id, id);
});

test('steps list/next/tick/add keep the rest of the file byte for byte (CRLF too)', (t) => {
  const { dir, plan } = setup(t);
  const original = PLAN('- [ ] S1. Write the test\n- [ ] S2. Implement sum').replace(/\n/g, '\r\n');
  writeFileSync(plan, original);
  assert.deepEqual(sh(dir, 'steps', ['next']).json.next, { n: 1, text: 'Write the test', done: false });
  let r = sh(dir, 'steps', ['tick', '--step', '1']);
  assert.deepEqual(r.json.progress, { done: 1, total: 2 });
  assert.equal(readFileSync(plan, 'utf8'), original.replace('- [ ] S1.', '- [x] S1.'));
  assert.equal(sh(dir, 'steps', ['tick', '--step', '1']).json.code, 'step-done');
  assert.equal(sh(dir, 'steps', ['tick', '--step', '7']).json.code, 'step-not-found');
  assert.equal(sh(dir, 'steps', ['tick', '--step', 'x']).json.code, 'bad-arguments');
  r = sh(dir, 'steps', ['add'], { text: 'Fix typo in README' });
  assert.deepEqual(r.json.added, { n: 3, text: 'Fix typo in README' });
  assert.match(readFileSync(plan, 'utf8'), /- \[ \] S2\. Implement sum\r\n- \[ \] S3\. Fix typo in README\r\n/);
  assert.equal(sh(dir, 'steps', ['add'], { text: 'two\nlines' }).json.code, 'bad-input');
  sh(dir, 'steps', ['tick', '--step', '2']);
  sh(dir, 'steps', ['tick', '--step', '3']);
  assert.equal(sh(dir, 'steps', ['next']).json.next, null);
});

test('status gates: planned needs a valid plan, implemented needs all steps', (t) => {
  const { dir, plan } = setup(t);
  sh(dir, 'change', ['set-status', '--to', 'clarified']);
  assert.equal(sh(dir, 'change', ['set-status', '--to', 'planned']).json.code, 'plan-not-found');
  sh(dir, 'plan', ['init']);
  const r = sh(dir, 'change', ['set-status', '--to', 'planned']);
  assert.equal(r.json.code, 'plan-invalid');
  assert.deepEqual(r.json.details.problems, ['Step S1 has no text.']);
  writeFileSync(plan, PLAN('- [ ] S1. A\n- [ ] S2. B'));
  assert.equal(sh(dir, 'change', ['set-status', '--to', 'planned']).code, 0);
  sh(dir, 'change', ['set-status', '--to', 'implementing']);
  sh(dir, 'steps', ['tick', '--step', '1']);
  const open = sh(dir, 'change', ['set-status', '--to', 'implemented']);
  assert.equal(open.json.code, 'steps-open');
  assert.deepEqual(open.json.details, { done: 1, total: 2 });
  sh(dir, 'steps', ['tick', '--step', '2']);
  assert.equal(sh(dir, 'change', ['set-status', '--to', 'implemented']).code, 0);
});

test('history init + add: dated row, escaping, files, missing history', (t) => {
  const { dir, history } = setup(t);
  assert.equal(sh(dir, 'history', ['add'], { change: 'x' }).json.code, 'history-not-found');
  assert.equal(sh(dir, 'history', ['init']).json.created, true);
  sh(dir, 'history', ['add'], { step: 1, change: 'Added `sum` test', files: ['test/sum.test.js'] });
  sh(dir, 'history', ['add'], { step: 2, change: 'a | b\nsecond line', files: ['src/sum.js', 'src/index.js'], notes: 'Deviation: used reduce' });
  sh(dir, 'history', ['add'], { change: 'Status implementing' });
  const rows = readFileSync(history, 'utf8').split('\n').filter((l) => /^\| \d{4}-\d{2}-\d{2} /.test(l));
  assert.equal(rows.length, 3);
  assert.match(rows[0], /^\| \d{4}-\d{2}-\d{2} \| S1 \| Added `sum` test \| `test\/sum\.test\.js` \| – \|$/);
  assert.match(rows[1], /\| S2 \| a \\\| b second line \| `src\/sum\.js`, `src\/index\.js` \| Deviation: used reduce \|$/);
  assert.match(rows[2], /\| – \| Status implementing \| – \| – \|$/);
  assert.match(readFileSync(history, 'utf8'), /\| – \|\n\n## Deviations from plan/, 'rows stay inside the table');
  assert.equal(sh(dir, 'history', ['add'], { change: '' }).json.code, 'bad-input');
});

test('knowledge init: build-test from template, never overwritten, only known names', (t) => {
  const { dir } = setup(t);
  let r = sh(dir, 'knowledge', ['init', '--name', 'build-test']);
  assert.deepEqual([r.json.created, r.json.path], [true, '.buggy/build-test.md']);
  writeFile(dir, '.buggy/build-test.md', '# mine\n');
  r = sh(dir, 'knowledge', ['init', '--name', 'build-test']);
  assert.equal(r.json.created, false);
  assert.equal(readFileSync(join(dir, '.buggy/build-test.md'), 'utf8'), '# mine\n');
  assert.equal(sh(dir, 'knowledge', ['init', '--name', '../x']).json.code, 'bad-arguments');
});

test('state and session-start show plan progress', (t) => {
  const { dir, plan } = setup(t);
  assert.equal(sh(dir, 'state', []).json.change.progress, null);
  writeFileSync(plan, PLAN('- [x] S1. A\n- [ ] S2. B\n- [ ] S3. C'));
  assert.deepEqual(sh(dir, 'state', []).json.change.progress, { done: 1, total: 3 });
});
