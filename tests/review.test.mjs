import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, gitIn, writeFile, runScript } from './helpers.mjs';
import { parseReview, approvalGate } from '../plugins/buggy/scripts/lib/review.mjs';

let k = 0;
const input = (dir, obj) => writeFile(dir, `.buggy/.tmp/i-${k++}.json`, JSON.stringify(obj));
const sh = (dir, script, args, obj) => runScript(script, obj ? [...args, '--input', input(dir, obj)] : args, { cwd: dir });

// A change in status "implemented" with one committed code change (src/a.js).
function implemented(t) {
  const dir = tempRepo(t);
  writeFile(dir, '.buggy/config.yaml', 'buggy: 1\n');
  writeFile(dir, '.buggy/.gitignore', '.tmp/\n'); // created by /buggy:start
  writeFile(dir, 'version.txt', '0.6.4\n');
  writeFile(dir, 'src/a.js', 'export const a = 1;\n');
  gitIn(dir, ['add', '.']);
  gitIn(dir, ['commit', '-q', '-m', 'setup']);
  const id = sh(dir, 'git', ['branch-new'], { title: 'Feature A' }).json.id;
  sh(dir, 'change', ['create', '--id', id], { title: 'Feature A' });
  writeFile(dir, `changes/${id}/plan.md`, '## Steps\n\n- [x] S1. Change a\n');
  for (const s of ['clarified', 'planned', 'implementing', 'implemented']) sh(dir, 'change', ['set-status', '--to', s]);
  writeFile(dir, 'src/a.js', 'export const a = 2;\n');
  gitIn(dir, ['add', '.']);
  gitIn(dir, ['commit', '-q', '-m', 'feat: a = 2']);
  return { dir, id, review: join(dir, 'changes', id, 'review.md') };
}

test('round 1: full diff from merge-base, docs excluded, untracked included, status in-review', (t) => {
  const { dir, id, review } = implemented(t);
  writeFile(dir, 'src/new.js', 'export const n = 1;\n');
  const r = sh(dir, 'review', ['round-start', '--type', 'incremental']);
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.round, 1);
  assert.equal(r.json.status, 'in-review');
  assert.deepEqual(r.json.files.sort(), ['src/a.js', 'src/new.js']);
  const patch = readFileSync(join(dir, r.json.diff), 'utf8');
  assert.match(patch, /-export const a = 1;\n\+export const a = 2;/);
  assert.match(patch, /\+export const n = 1;/);
  assert.doesNotMatch(patch, /changes\//);
  assert.equal(sh(dir, 'change', ['show']).json.meta.status, 'in-review');
  const text = readFileSync(review, 'utf8');
  assert.match(text, /## Round 1\n\n- \*\*Date:\*\* \d{4}-\d{2}-\d{2}\n- \*\*Type:\*\* incremental\n- \*\*Diff:\*\* `[0-9a-f]{7}` → working tree \(2 files\)\n- \*\*Checkpoint:\*\* –\n/);
  assert.ok(text.indexOf('## Round 1') < text.indexOf('## Acceptance criteria check'));
  assert.equal(gitIn(dir, ['status', '--porcelain', '--', '.buggy/.tmp']), '', 'diff file never shows in git status');
});

test('findings: numbering, escaping, validation, update', (t) => {
  const { dir, review } = implemented(t);
  sh(dir, 'review', ['round-start', '--type', 'incremental']);
  let r = sh(dir, 'review', ['finding-add'], { source: 'code-reviewer', severity: 'major', finding: 'a | b\nnext', location: 'src/a.js:1' });
  assert.equal(r.json.id, 'R1.1');
  r = sh(dir, 'review', ['finding-add'], { source: 'user', severity: 'nit', finding: 'Rename', decision: 'reject – style only' });
  assert.equal(r.json.id, 'R1.2');
  assert.equal(sh(dir, 'review', ['finding-add'], { severity: 'huge', finding: 'x' }).json.code, 'bad-input');
  assert.equal(sh(dir, 'review', ['finding-add'], { severity: 'minor', finding: 'x', decision: 'maybe' }).json.code, 'bad-input');
  r = sh(dir, 'review', ['finding-update', '--finding', 'R1.1'], { decision: 'fix', status: 'done' });
  assert.deepEqual([r.json.decision, r.json.status], ['fix', 'done']);
  assert.equal(sh(dir, 'review', ['finding-update', '--finding', 'R9.9'], { status: 'done' }).json.code, 'finding-not-found');
  const f = parseReview(readFileSync(review, 'utf8')).rounds[0].findings;
  assert.deepEqual(
    f.map((x) => [x.id, x.source, x.severity, x.finding, x.decision, x.status]),
    [
      ['R1.1', 'code-reviewer', 'major', 'a \\| b next', 'fix', 'done'],
      ['R1.2', 'user', 'nit', 'Rename', 'reject – style only', 'open'],
    ],
  );
});

test('round-end checkpoint; incremental round 2 diffs from the checkpoint only', (t) => {
  const { dir } = implemented(t);
  sh(dir, 'review', ['round-start', '--type', 'incremental']);
  assert.equal(sh(dir, 'review', ['round-start', '--type', 'incremental']).json.code, 'round-open');
  const end = sh(dir, 'review', ['round-end']);
  assert.equal(end.json.uncommitted, 0);
  assert.equal(existsSync(join(dir, '.buggy/.tmp/review-r1.patch')), false, 'patch removed at round end');
  assert.equal(sh(dir, 'review', ['finding-add'], { severity: 'nit', finding: 'late' }).json.code, 'round-closed');
  writeFile(dir, 'src/fix.js', 'export const f = 1;\n');
  gitIn(dir, ['add', '.']);
  gitIn(dir, ['commit', '-q', '-m', 'fix']);
  const r2 = sh(dir, 'review', ['round-start', '--type', 'incremental']);
  assert.equal(r2.json.round, 2);
  assert.deepEqual(r2.json.files, ['src/fix.js'], 'only what changed since the checkpoint');
  sh(dir, 'review', ['round-end']);
  const fin = sh(dir, 'review', ['round-start', '--type', 'final']);
  assert.deepEqual(fin.json.files.sort(), ['src/a.js', 'src/fix.js'], 'final round: full diff again');
});

test('approval gate: final round, finished, decisions, fixes done', (t) => {
  const { dir } = implemented(t);
  sh(dir, 'review', ['round-start', '--type', 'incremental']);
  sh(dir, 'review', ['finding-add'], { source: 'security-reviewer', severity: 'blocker', finding: 'SQL injection', decision: 'fix' });
  sh(dir, 'review', ['finding-add'], { source: 'code-reviewer', severity: 'minor', finding: 'Undecided' });
  sh(dir, 'review', ['round-end']);
  let st = sh(dir, 'review', ['status']).json;
  assert.equal(st.open, 2);
  assert.deepEqual(st.approval.problems, [
    'The last round (1) is not a final round.',
    'R1.1 is to be fixed and is not done.',
    'R1.2 has no decision.',
  ]);
  assert.equal(sh(dir, 'change', ['set-status', '--to', 'approved']).json.code, 'review-open');
  sh(dir, 'review', ['finding-update', '--finding', 'R1.1'], { status: 'done' });
  sh(dir, 'review', ['finding-update', '--finding', 'R1.2'], { decision: 'defer → idea 20261119-x', status: 'done' });
  sh(dir, 'review', ['round-start', '--type', 'final']);
  assert.deepEqual(sh(dir, 'review', ['status']).json.approval.problems, ['The last round (2) is not finished.']);
  sh(dir, 'review', ['round-end']);
  st = sh(dir, 'review', ['status']).json;
  assert.equal(st.approval.ok, true);
  assert.equal(sh(dir, 'change', ['set-status', '--to', 'approved']).code, 0);
  // reopening after approval
  const again = sh(dir, 'review', ['round-start', '--type', 'incremental']);
  assert.equal(again.json.status, 'in-review');
  assert.equal(sh(dir, 'change', ['show']).json.meta.status, 'in-review');
});

test('round-start refuses changes that are not implemented yet', (t) => {
  const dir = tempRepo(t);
  writeFile(dir, '.buggy/config.yaml', 'buggy: 1\n');
  gitIn(dir, ['add', '.']);
  gitIn(dir, ['commit', '-q', '-m', 'setup']);
  const id = sh(dir, 'git', ['branch-new'], { title: 'Early' }).json.id;
  sh(dir, 'change', ['create', '--id', id], { title: 'Early' });
  assert.equal(sh(dir, 'review', ['round-start', '--type', 'incremental']).json.code, 'bad-status');
});

test('approvalGate on a hand-written review', () => {
  const md = '## Round 1\n\n- **Type:** final\n- **Checkpoint:** `abcdef1`\n\n| # | Source | Severity | Finding | Location | Decision | Status |\n|---|---|---|---|---|---|---|\n| R1.1 | user | nit | x | – | fix | open |\n';
  assert.deepEqual(approvalGate(md).problems, [
    'The final round (1) led to fixes; run another final round to review them.',
    'R1.1 is to be fixed and is not done.',
  ]);
});

test('approval gate: a final round with fixes needs another final round', () => {
  const head = '| # | Source | Severity | Finding | Location | Decision | Status |\n|---|---|---|---|---|---|---|\n';
  const md =
    `## Round 1\n\n- **Type:** final\n- **Checkpoint:** \`abcdef1\`\n\n${head}| R1.1 | code-reviewer | major | x | – | fix | done |\n\n` ;
  assert.deepEqual(approvalGate(md).problems, ['The final round (1) led to fixes; run another final round to review them.']);
  const md2 = `${md}## Round 2\n\n- **Type:** final\n- **Checkpoint:** \`abcdef2\`\n\n${head}| R2.1 | user | nit | y | – | reject – fine | done |\n`;
  assert.equal(approvalGate(md2).ok, true);
});

test('state shows review progress', (t) => {
  const { dir } = implemented(t);
  assert.equal(sh(dir, 'state', []).json.change.review, null);
  sh(dir, 'review', ['round-start', '--type', 'incremental']);
  sh(dir, 'review', ['finding-add'], { source: 'user', severity: 'minor', finding: 'x' });
  const r = sh(dir, 'state', []).json.change.review;
  assert.deepEqual(r, { rounds: 1, lastRound: { n: 1, type: 'incremental', finished: false }, findings: 1, open: 1 });
});
