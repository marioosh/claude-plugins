import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, tempDir, gitIn, writeFile, runScript, GIT_ENV } from './helpers.mjs';
import {
  createChange,
  loadChange,
  listChanges,
  setStatus,
  newChangeId,
  idFromBranch,
  specHash,
  TRANSITIONS,
} from '../plugins/buggy/scripts/lib/change.mjs';
import { splitFrontmatter } from '../plugins/buggy/scripts/lib/yaml.mjs';

Object.assign(process.env, GIT_ENV);

async function code(fn) {
  try {
    await fn();
  } catch (e) {
    return e.code;
  }
  return 'no-error';
}

function buggyRepo(t) {
  const dir = tempRepo(t);
  writeFile(dir, '.buggy/config.yaml', 'buggy: 1\n');
  writeFile(dir, 'version.txt', '0.6.4\n');
  gitIn(dir, ['add', '.']);
  gitIn(dir, ['commit', '-q', '-m', 'setup']);
  return dir;
}

const ID = '20261119-club-meetings';

// A valid plan with every step done (so both gates pass: planned, implemented).
function donePlan(dir, id = ID) {
  writeFile(dir, `changes/${id}/plan.md`, '# Plan\n\n## Steps\n\n- [x] S1. Do it\n');
  // A finished final review round (gate for "approved").
  writeFile(
    dir,
    `changes/${id}/review.md`,
    '# R\n\n## Round 1\n\n- **Type:** final\n- **Diff:** `abc1234` → working tree (1 file)\n- **Checkpoint:** `def5678`\n\n| # | Source | Severity | Finding | Location | Decision | Status |\n|---|---|---|---|---|---|---|\n',
  );
}

function make(dir, extra = {}) {
  return createChange(dir, { id: ID, title: 'Club meetings', change: 'minor', baseVersion: '0.6.4', created: '20261119', ...extra });
}

test('createChange writes frontmatter + spec template', async (t) => {
  const dir = buggyRepo(t);
  await make(dir);
  const { data, body } = splitFrontmatter(readFileSync(join(dir, 'changes', ID, 'spec.md'), 'utf8'));
  assert.deepEqual(data, {
    id: ID,
    title: 'Club meetings',
    change: 'minor',
    base_version: '0.6.4',
    status: 'draft',
    branch: `feature/${ID}`,
    created: '2026-11-19',
    from_idea: null,
    spec_hash: null,
    version: null,
    shipped: null,
  });
  assert.match(body, /^# Club meetings\n/);
  assert.match(body, /## Acceptance criteria/);
});

test('createChange: user text with YAML/shell characters stays intact', async (t) => {
  const dir = buggyRepo(t);
  const title = 'Fix: "quotes" # hash $(x) – ąę';
  await make(dir, { title });
  assert.equal(loadChange(dir, ID).meta.title, title);
});

test('createChange refuses duplicates and bad input', async (t) => {
  const dir = buggyRepo(t);
  await make(dir);
  assert.equal(await code(() => make(dir)), 'change-exists');
  assert.equal(await code(() => make(dir, { id: '20261119-other', change: 'patch' })), 'bad-change-kind');
  assert.equal(await code(() => make(dir, { id: '20261119-other', title: ' ' })), 'bad-input');
  assert.equal(await code(() => make(dir, { id: '../x' })), 'bad-id');
});

test('newChangeId avoids existing folders and feature branches', async (t) => {
  const dir = buggyRepo(t);
  assert.equal(await newChangeId(dir, 'Club meetings', '20261119'), ID);
  gitIn(dir, ['branch', `feature/${ID}`]);
  assert.equal(await newChangeId(dir, 'Club meetings', '20261119'), `${ID}-2`);
});

test('idFromBranch', () => {
  assert.equal(idFromBranch(`feature/${ID}`), ID);
  assert.equal(idFromBranch('main'), null);
  assert.equal(idFromBranch('feature/whatever'), null);
});

test('status flow: draft → … → shipped, body kept byte for byte', async (t) => {
  const dir = buggyRepo(t);
  await make(dir);
  const path = join(dir, 'changes', ID, 'spec.md');
  const body0 = splitFrontmatter(readFileSync(path, 'utf8')).body;
  donePlan(dir);
  for (const s of ['clarified', 'planned', 'implementing', 'implemented', 'in-review', 'approved']) {
    setStatus(dir, ID, s);
  }
  setStatus(dir, ID, 'shipped', { version: '0.7.0', date: '2026-11-20' });
  const c = loadChange(dir, ID);
  assert.equal(c.meta.status, 'shipped');
  assert.equal(c.meta.version, '0.7.0');
  assert.equal(c.meta.shipped, '2026-11-20');
  assert.equal(c.body, body0);
});

test('forbidden transitions are refused with the allowed list', async (t) => {
  const dir = buggyRepo(t);
  await make(dir);
  try {
    setStatus(dir, ID, 'planned');
    assert.fail('expected error');
  } catch (e) {
    assert.equal(e.code, 'bad-transition');
    assert.deepEqual(e.details.allowed, TRANSITIONS.draft);
  }
  assert.equal(await code(() => setStatus(dir, ID, 'nonsense')), 'bad-status');
});

test('spec edited after clarify: detected, planning refused, clarify again resets', async (t) => {
  const dir = buggyRepo(t);
  await make(dir);
  setStatus(dir, ID, 'clarified');
  assert.equal(loadChange(dir, ID).specChanged, false);
  appendFileSync(join(dir, 'changes', ID, 'spec.md'), '\nNew requirement.\n');
  assert.equal(loadChange(dir, ID).specChanged, true);
  assert.equal(await code(() => setStatus(dir, ID, 'planned')), 'spec-changed');
  setStatus(dir, ID, 'clarified');
  assert.equal(loadChange(dir, ID).specChanged, false);
  donePlan(dir);
  setStatus(dir, ID, 'planned');
});

test('specHash ignores line endings and trailing whitespace', () => {
  assert.equal(specHash('a\nb\n'), specHash('a  \r\nb\r\n\n'));
  assert.notEqual(specHash('a\nb'), specHash('a\nc'));
});

test('abandon requires a reason; shipped and abandoned are final', async (t) => {
  const dir = buggyRepo(t);
  await make(dir);
  assert.equal(await code(() => setStatus(dir, ID, 'abandoned')), 'bad-input');
  setStatus(dir, ID, 'abandoned', { reason: 'Not needed', date: '2026-11-21' });
  const c = loadChange(dir, ID);
  assert.equal(c.meta.abandon_reason, 'Not needed');
  assert.equal(c.meta.abandoned, '2026-11-21');
  assert.equal(await code(() => setStatus(dir, ID, 'clarified')), 'bad-transition');
});

test('listChanges reports broken folders instead of failing', async (t) => {
  const dir = buggyRepo(t);
  await make(dir);
  writeFile(dir, 'changes/not-an-id/spec.md', 'x');
  writeFile(dir, 'changes/20261118-broken/spec.md', 'no frontmatter');
  const list = listChanges(dir);
  assert.equal(list.length, 3);
  assert.equal(list.find((c) => c.id === ID).status, 'draft');
  assert.ok(list.find((c) => c.id === 'not-an-id').error);
  assert.ok(list.find((c) => c.id === '20261118-broken').error);
});

// ---------- change.mjs ----------

test('change.mjs create on the right branch; show and list', async (t) => {
  const dir = buggyRepo(t);
  gitIn(dir, ['switch', '-q', '-c', `feature/${ID}`]);
  const input = join(tempDir(t), 'in.json');
  writeFileSync(input, JSON.stringify({ title: 'Club meetings', change: 'bugfix' }));
  let r = runScript('change', ['create', '--id', ID, '--input', input], { cwd: dir });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.meta.base_version, '0.6.4');
  assert.equal(r.json.meta.change, 'bugfix');
  r = runScript('change', ['show'], { cwd: dir });
  assert.equal(r.json.id, ID);
  assert.equal(r.json.onBranch, true);
  r = runScript('change', ['list'], { cwd: dir });
  assert.equal(r.json.changes.length, 1);
});

test('change.mjs create refuses the wrong branch', async (t) => {
  const dir = buggyRepo(t);
  const input = join(tempDir(t), 'in.json');
  writeFileSync(input, JSON.stringify({ title: 'X' }));
  const r = runScript('change', ['create', '--id', ID, '--input', input], { cwd: dir });
  assert.equal(r.code, 1);
  assert.equal(r.json.code, 'wrong-branch');
});

test('change.mjs set-status with a reason from JSON input', async (t) => {
  const dir = buggyRepo(t);
  await make(dir);
  const input = join(tempDir(t), 'reason.json');
  writeFileSync(input, JSON.stringify({ reason: 'Duplicate of another change' }));
  const r = runScript('change', ['set-status', '--id', ID, '--to', 'abandoned', '--input', input], { cwd: dir });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.to, 'abandoned');
  assert.equal(runScript('change', ['show'], { cwd: dir }).json.code, 'no-change');
});

test('createChange puts the user description word for word into Goal (D-4)', async (t) => {
  const dir = tempRepo(t);
  const text = 'Poprawić odwołania do `docs/UI.md` → `.buggy/ui.md`; "cudzysłowy" i $(nie-shell).';
  await createChange(dir, { id: '20261121-odwolania', title: 'Odwołania do dokumentów', change: 'bugfix', baseVersion: '0.6.4', description: text });
  const spec = readFileSync(join(dir, 'changes/20261121-odwolania/spec.md'), 'utf8');
  assert.match(spec, /^title: Odwołania do dokumentów$/m);
  const goal = spec.slice(spec.indexOf('## Goal'), spec.indexOf('## Requirements'));
  assert.ok(goal.includes(text), goal);
  assert.ok(spec.indexOf(text) < spec.indexOf('## Requirements'));
  await assert.rejects(createChange(dir, { id: '20261121-inna', title: 'X', change: 'minor', baseVersion: '0.6.4', description: 42 }), /description must be text/);
});
