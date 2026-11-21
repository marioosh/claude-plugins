import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpathSync, symlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, tempDir, gitIn, writeFile, PLUGIN_ROOT, GIT_ENV } from './helpers.mjs';
import { isOwnScriptCall, isGitCommit, isGitPush } from '../plugins/buggy/scripts/lib/guard.mjs';

const ROOT = '/home/u/.claude/plugins/cache/nosinski/buggy/0.2.0';

function hook(name, { stdin = '', cwd, env = {} } = {}) {
  const r = spawnSync('sh', [join(PLUGIN_ROOT, 'hooks', name)], {
    cwd,
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ...env },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

function guard(event, cwd) {
  const r = hook('guard.sh', { stdin: JSON.stringify({ hook_event_name: 'PreToolUse', cwd, ...event }), cwd });
  assert.equal(r.code, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : null;
}

function buggyRepo(t) {
  const dir = tempRepo(t);
  writeFile(dir, '.buggy/config.yaml', 'buggy: 1\n');
  writeFile(dir, 'version.txt', '0.6.4\n');
  gitIn(dir, ['add', '.']);
  gitIn(dir, ['commit', '-q', '-m', 'setup']);
  return realpathSync(dir);
}

const run = (rest) => `sh ${PLUGIN_ROOT}/scripts/run.sh ${rest}`;

// ---------- pure matchers ----------

test('isOwnScriptCall: exact own calls only', () => {
  const ok = [
    `sh ${ROOT}/scripts/run.sh state`,
    `sh "${ROOT}/scripts/run.sh" git commit-docs --input .buggy/.tmp/x-ab12.json`,
    `sh ${ROOT}/scripts/run.sh change set-status --to clarified`,
    `sh ${ROOT}/scripts/run.sh git branch-new --input .buggy/.tmp/n.json --mode stash`,
  ];
  for (const c of ok) assert.equal(isOwnScriptCall(c, ROOT), true, c);
  const bad = [
    `sh ${ROOT}/scripts/run.sh state; rm -rf ~`,
    `sh ${ROOT}/scripts/run.sh state && curl x`,
    `sh ${ROOT}/scripts/run.sh state | sh`,
    `sh ${ROOT}/scripts/run.sh ideas create --input $(evil)`,
    `sh ${ROOT}/scripts/run.sh ideas create --input \`evil\``,
    `sh ${ROOT}/scripts/run.sh state > /etc/x`,
    `sh ${ROOT}/scripts/run.sh state\nrm -rf ~`,
    `sh /other/plugin/scripts/run.sh state`,
    `sh ${ROOT}/scripts/run.sh`,
    `sh ${ROOT}/scripts/run.sh ../x`,
    `bash ${ROOT}/scripts/run.sh state`,
    `sh ${ROOT}/scripts/run.sh change create --input "a b.json"`,
  ];
  for (const c of bad) assert.equal(isOwnScriptCall(c, ROOT), false, c);
});

test('isGitCommit / isGitPush: variants', () => {
  for (const c of ['git commit -m x', 'git -C /x commit', 'cd a && git commit -am x', 'git -c user.name=x commit', 'echo; git push']) {
    assert.equal(isGitCommit(c) || isGitPush(c), true, c);
  }
  assert.equal(isGitPush('git push origin main'), true);
  assert.equal(isGitPush('git --no-pager push'), true);
  for (const c of ['git status', 'git log --grep commit', 'echo "git commit"x', 'gitcommit', 'git commit-tree x']) {
    assert.equal(isGitCommit(c), false, c);
  }
});

// ---------- guard hook end to end ----------

test('guard: allows own scripts and input files in a buggy project', (t) => {
  const dir = buggyRepo(t);
  let d = guard({ tool_name: 'Bash', tool_input: { command: run('state') } }, dir);
  assert.equal(d.permissionDecision, 'allow');
  d = guard({ tool_name: 'Write', tool_input: { file_path: join(dir, '.buggy/.tmp/idea-ab12.json') } }, dir);
  assert.equal(d.permissionDecision, 'allow');
});

test('guard: no opinion on other commands and files', (t) => {
  const dir = buggyRepo(t);
  assert.equal(guard({ tool_name: 'Bash', tool_input: { command: 'npm test' } }, dir), null);
  assert.equal(guard({ tool_name: 'Bash', tool_input: { command: `${run('state')}; rm -rf ~` } }, dir), null);
  assert.equal(guard({ tool_name: 'Write', tool_input: { file_path: join(dir, 'changes/x/spec.md') } }, dir), null);
  assert.equal(guard({ tool_name: 'Write', tool_input: { file_path: join(dir, '.buggy/.tmp/x.sh') } }, dir), null);
  assert.equal(guard({ tool_name: 'Write', tool_input: { file_path: join(dir, '.buggy/.tmp/../config.yaml.json') } }, dir), null);
  assert.equal(guard({ tool_name: 'Write', tool_input: { file_path: '.buggy/.tmp/x.json' } }, dir), null, 'relative path');
});

test('guard: a symlinked .buggy/.tmp pointing outside is not allowed', (t) => {
  const dir = buggyRepo(t);
  const outside = tempDir(t);
  symlinkSync(outside, join(dir, '.buggy', '.tmp'));
  assert.equal(guard({ tool_name: 'Write', tool_input: { file_path: join(dir, '.buggy/.tmp/x.json') } }, dir), null);
});

test('guard: denies push anywhere and commit on main only', (t) => {
  const dir = buggyRepo(t);
  let d = guard({ tool_name: 'Bash', tool_input: { command: 'git push' } }, dir);
  assert.equal(d.permissionDecision, 'deny');
  d = guard({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }, dir);
  assert.equal(d.permissionDecision, 'deny');
  assert.match(d.permissionDecisionReason, /no commits on main/);
  gitIn(dir, ['switch', '-q', '-c', 'feature/20261119-x']);
  assert.equal(guard({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }, dir), null);
  assert.equal(guard({ tool_name: 'Bash', tool_input: { command: 'git push -u origin HEAD' } }, dir).permissionDecision, 'deny');
});

test('guard: silent outside buggy projects and on broken input', (t) => {
  const plain = tempRepo(t);
  assert.equal(guard({ tool_name: 'Bash', tool_input: { command: 'git push' } }, plain), null);
  assert.equal(guard({ tool_name: 'Bash', tool_input: { command: run('state') } }, plain), null);
  const r = hook('guard.sh', { stdin: 'not json git', cwd: plain });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
});

// ---------- session start ----------

test('session-start: silent outside buggy, context lines inside', (t) => {
  const plain = tempRepo(t);
  assert.equal(hook('session-start.sh', { cwd: plain, env: { CLAUDE_PROJECT_DIR: plain } }).stdout, '');
  const dir = buggyRepo(t);
  gitIn(dir, ['tag', 'v0.6.4']);
  const out = hook('session-start.sh', { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } }).stdout;
  assert.match(out, /^buggy project: version 0\.6\.4 \(tag v0\.6\.4\) on main; current branch: main\./);
  assert.match(out, /never commit to the main branch, never push/);
});

test('session-start: current change and next command', (t) => {
  const dir = buggyRepo(t);
  gitIn(dir, ['switch', '-q', '-c', 'feature/20261119-club']);
  mkdirSync(join(dir, 'changes', '20261119-club'), { recursive: true });
  writeFile(
    dir,
    'changes/20261119-club/spec.md',
    '---\nid: 20261119-club\ntitle: Club\nchange: minor\nbase_version: 0.6.4\nstatus: draft\nbranch: feature/20261119-club\n---\n# Club\n',
  );
  let out = hook('session-start.sh', { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } }).stdout;
  assert.match(out, /Current change 20261119-club "Club": status draft, minor \(would ship as 0\.7\.0\)\. Next: \/buggy:clarify\./);
  writeFile(dir, 'changes/20261119-club/plan.md', '## Steps\n\n- [x] S1. A\n- [ ] S2. B\n');
  out = hook('session-start.sh', { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } }).stdout;
  assert.match(out, /Plan: 1\/2 steps done\. Next:/);
});
