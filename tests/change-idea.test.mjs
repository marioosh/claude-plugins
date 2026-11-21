import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, gitIn, writeFile, runScript } from './helpers.mjs';
import { ideaSection } from '../plugins/buggy/scripts/lib/change.mjs';

function buggyRepo(t) {
  const dir = tempRepo(t);
  writeFile(dir, '.buggy/config.yaml', 'buggy: 1\n');
  writeFile(dir, 'version.txt', '0.6.4\n');
  gitIn(dir, ['add', '.']);
  gitIn(dir, ['commit', '-q', '-m', 'setup']);
  return dir;
}

let n = 0;
const input = (dir, obj) => writeFile(dir, `.buggy/.tmp/in-${n++}.json`, JSON.stringify(obj));
const run = (dir, script, args, obj) => runScript(script, obj ? [...args, '--input', input(dir, obj)] : args, { cwd: dir });

function newIdea(dir, title, description = '') {
  const r = run(dir, 'ideas', ['create'], { title, description });
  gitIn(dir, ['add', '.']);
  gitIn(dir, ['commit', '-q', '-m', `idea ${title}`]);
  return r.json.id;
}

test('ideaSection drops the H1 and demotes headings', () => {
  const s = ideaSection('# Heatmap\n\n- **Date:** 2026-11-18\n\n## Description\n\nGrid.\n');
  assert.equal(s, '## Idea\n\n- **Date:** 2026-11-18\n\n### Description\n\nGrid.\n');
});

test('new change from an idea on main: git mv keeps history, Idea section, from_idea', (t) => {
  const dir = buggyRepo(t);
  const ideaId = newIdea(dir, 'Heatmapa aktywności', 'Siatka dni jak na GitHubie.');
  const b = run(dir, 'git', ['branch-new'], { title: 'Heatmapa aktywności' }).json;
  const c = run(dir, 'change', ['create', '--id', b.id], { fromIdea: ideaId });
  assert.equal(c.code, 0, c.stdout);
  assert.equal(c.json.meta.title, 'Heatmapa aktywności', 'title taken from the idea');
  assert.equal(c.json.meta.from_idea, ideaId);
  assert.equal(c.json.idea.moved, true);
  assert.equal(c.json.renameCommitted, true);
  assert.equal(existsSync(join(dir, 'ideas', `${ideaId}.md`)), false);
  const spec = readFileSync(join(dir, 'changes', b.id, 'spec.md'), 'utf8');
  assert.match(spec, /# Heatmapa aktywności\n\n## Idea\n\n- \*\*Date:\*\* .*\n\n### Description\n\nSiatka dni jak na GitHubie\./);
  assert.match(spec, /## Acceptance criteria/);

  const commit = run(dir, 'git', ['commit-docs'], { message: `docs: start ${b.id}` });
  assert.equal(commit.code, 0, commit.stdout);
  const follow = gitIn(dir, ['log', '--follow', '--format=%s', '--', `changes/${b.id}/spec.md`]).split('\n');
  assert.deepEqual(
    follow,
    [`docs: start ${b.id}`, `docs: move idea ${ideaId} to change ${b.id}`, 'idea Heatmapa aktywności'],
    'history of the idea continues in spec.md',
  );
});

test('new change from an idea that exists only on another branch: copied, warning', (t) => {
  const dir = buggyRepo(t);
  gitIn(dir, ['switch', '-q', '-c', 'feature/20261118-other']);
  const ideaId = newIdea(dir, 'Remote idea');
  gitIn(dir, ['switch', '-q', 'main']);
  const b = run(dir, 'git', ['branch-new'], { title: 'Remote idea' }).json;
  const c = run(dir, 'change', ['create', '--id', b.id], { fromIdea: ideaId });
  assert.equal(c.code, 0, c.stdout);
  assert.equal(c.json.idea.moved, false);
  assert.match(c.json.warning, /exists only on branch feature\/20261118-other/);
  assert.match(readFileSync(join(dir, 'changes', b.id, 'spec.md'), 'utf8'), /## Idea/);
});

test('set-kind: allowed until planned, locked afterwards, validated', (t) => {
  const dir = buggyRepo(t);
  const b = run(dir, 'git', ['branch-new'], { title: 'Small fix' }).json;
  run(dir, 'change', ['create', '--id', b.id], { title: 'Small fix', change: 'bugfix' });
  let r = run(dir, 'change', ['set-kind', '--kind', 'minor']);
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual([r.json.from, r.json.to], ['bugfix', 'minor']);
  assert.equal(run(dir, 'change', ['set-kind', '--kind', 'patch']).json.code, 'bad-change-kind');
  writeFile(dir, `changes/${b.id}/plan.md`, '## Steps\n\n- [ ] S1. Fix\n');
  for (const s of ['clarified', 'planned', 'implementing']) run(dir, 'change', ['set-status', '--to', s]);
  assert.equal(run(dir, 'change', ['set-kind', '--kind', 'major']).json.code, 'kind-locked');
});

test('ideas list marks ideas that already became a change (startedAs)', (t) => {
  const dir = buggyRepo(t);
  gitIn(dir, ['switch', '-q', '-c', 'chore/20261118-idea-x']);
  const ideaId = newIdea(dir, 'Started idea');
  const b = run(dir, 'git', ['branch-new'], { title: 'Started idea' }).json;
  run(dir, 'change', ['create', '--id', b.id], { fromIdea: ideaId });
  run(dir, 'git', ['commit-docs'], { message: 'docs: start' });
  const list = run(dir, 'ideas', ['list']).json;
  assert.equal(list.ideas.find((i) => i.id === ideaId).startedAs, b.id);
});
