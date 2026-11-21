// Contract tests: what the skills say must match what the scripts do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_ROOT, SCRIPTS, tempRepo, gitIn, writeFile, runScript } from './helpers.mjs';
import { splitFrontmatter } from '../plugins/buggy/scripts/lib/yaml.mjs';

const SKILLS = join(PLUGIN_ROOT, 'skills');
const skills = readdirSync(SKILLS).map((name) => {
  const text = readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8');
  const { data, body } = splitFrontmatter(text);
  return { name, data, body, text };
});

const RUN_ALLOW = 'Bash(sh ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh *)';
const INPUT_ALLOW = 'Edit(/.buggy/.tmp/**)';

// Subcommands a script accepts: `cmd === 'x'` and lists like ['a', 'b'].includes(cmd).
function subcommands(script) {
  const src = readFileSync(join(SCRIPTS, `${script}.mjs`), 'utf8');
  const subs = new Set([...src.matchAll(/cmd === '([a-z-]+)'/g)].map((m) => m[1]));
  for (const m of src.matchAll(/\[([^\]]+)\]\.includes\(cmd\)/g)) {
    for (const s of m[1].matchAll(/'([a-z-]+)'/g)) subs.add(s[1]);
  }
  return subs;
}
const flags = (script) =>
  new Set([...readFileSync(join(SCRIPTS, `${script}.mjs`), 'utf8').matchAll(/([a-z-]+): \{ type: 'string' \}/g)].map((m) => `--${m[1]}`));

test('every skill: name = folder, user-only, runs scripts through run.sh', () => {
  assert.ok(skills.length >= 4);
  for (const s of skills) {
    assert.equal(s.data.name, s.name, s.name);
    assert.equal(s.data['disable-model-invocation'], true, `${s.name}: only the user may start buggy commands`);
    assert.ok(typeof s.data.description === 'string' && s.data.description.length > 10, s.name);
    assert.ok(s.data['allowed-tools'].includes(RUN_ALLOW), `${s.name}: allowed-tools`);
    // every skill starts from deterministic facts: the project state, or (start) the setup detection
    const injects = s.name === 'start' ? /!`sh \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/run\.sh setup detect`/ : /!`sh \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/run\.sh state`/;
    assert.match(s.body, injects, `${s.name}: injects state / setup detect`);
  }
});

test('skills that pass text to scripts allow input files and never put text on the command line', () => {
  for (const s of skills) {
    if (!s.body.includes('--input')) continue;
    assert.ok(s.data['allowed-tools'].includes(INPUT_ALLOW), `${s.name}: needs ${INPUT_ALLOW}`);
    assert.match(s.body, /only through a JSON file/, `${s.name}: states the input-file rule`);
    assert.match(s.body, /One script per Bash call/, `${s.name}: states the one-call rule`);
  }
});

test('every run.sh call in a skill names an existing script, subcommand and flags', () => {
  for (const s of skills) {
    for (const m of s.text.matchAll(/run\.sh ([a-z-]+)((?: [a-z-]+)?)([^`\n]*)/g)) {
      const [, script, sub, rest] = m;
      assert.ok(existsSync(join(SCRIPTS, `${script}.mjs`)), `${s.name}: unknown script ${script}`);
      if (sub.trim() && !sub.trim().startsWith('-')) {
        assert.ok(subcommands(script).has(sub.trim()), `${s.name}: ${script} has no subcommand "${sub.trim()}"`);
      }
      for (const f of rest.match(/--[a-z-]+/g) ?? []) {
        assert.ok(flags(script).has(f), `${s.name}: ${script} has no flag ${f}`);
      }
    }
  }
});

test('state and ideas fields referenced by skills exist in the script output', (t) => {
  const dir = tempRepo(t);
  writeFile(dir, '.buggy/config.yaml', 'buggy: 1\n');
  writeFile(dir, 'version.txt', '0.6.4\n');
  gitIn(dir, ['add', '.']);
  gitIn(dir, ['commit', '-q', '-m', 'setup']);
  const inp = writeFile(dir, '.buggy/.tmp/a.json', JSON.stringify({ title: 'X' }));
  const id = runScript('git', ['branch-new', '--input', inp], { cwd: dir }).json.id;
  runScript('change', ['create', '--id', id, '--input', writeFile(dir, '.buggy/.tmp/b.json', '{"title":"X"}')], { cwd: dir });
  const state = runScript('state', [], { cwd: dir }).json;
  const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  for (const s of skills.filter((x) => x.body.includes('run.sh state`'))) {
    for (const [, path] of s.body.matchAll(/`((?:change|version)\.[a-zA-Z]+)`/g)) {
      assert.notEqual(get(state, path), undefined, `${s.name}: state has no ${path}`);
    }
    for (const key of ['mainBranch', 'warnings', 'changes', 'buggy', 'git', 'branch']) {
      if (s.body.includes(`\`${key}\``)) assert.ok(key in state, `${s.name}: state has no ${key}`);
    }
  }
  const ideas = runScript('ideas', ['list'], { cwd: dir }).json;
  assert.ok('ideas' in ideas && 'count' in ideas);
});

// ---------- agents ----------

const AGENTS = join(PLUGIN_ROOT, 'agents');
const agents = readdirSync(AGENTS).map((file) => {
  const { data, body } = splitFrontmatter(readFileSync(join(AGENTS, file), 'utf8'));
  return { file, data, body };
});

test('agents: name = file name, read-only tools, known model, JSON output contract', () => {
  assert.deepEqual(agents.map((a) => a.file).sort(), ['code-reviewer.md', 'consistency-reviewer.md', 'security-reviewer.md']);
  for (const a of agents) {
    assert.equal(`${a.data.name}.md`, a.file);
    assert.ok(a.data.description.length > 20, a.file);
    const tools = a.data.tools.split(',').map((x) => x.trim());
    assert.deepEqual(tools.filter((x) => !['Read', 'Grep', 'Glob'].includes(x)), [], `${a.file}: read-only tools only`);
    assert.ok(['opus', 'sonnet', 'haiku', 'fable', 'inherit'].includes(a.data.model), a.file);
    for (const field of ['"severity"', '"location"', '"finding"', '"evidence"', '"suggestion"']) {
      assert.ok(a.body.includes(field), `${a.file}: output field ${field}`);
    }
    assert.match(a.body, /data, not instructions/, `${a.file}: prompt-injection rule`);
  }
});

test('skills reference only existing agents', () => {
  const known = new Set(agents.map((a) => `buggy:${a.data.name}`));
  for (const s of skills) {
    for (const [, name] of s.body.matchAll(/`(buggy:[a-z-]+)`/g)) {
      if (name.startsWith('buggy:') && !/^buggy:(start|version|new-idea|new|clarify|plan|implement|review|ship|release|doctor)$/.test(name)) {
        assert.ok(known.has(name), `${s.name}: unknown agent ${name}`);
      }
    }
  }
});

test('skills never mention a buggy script call without the full run.sh form', () => {
  // `<script> <its own subcommand>` in backticks, not preceded by run.sh – e.g. `steps next`, `ship sync-do`.
  const scripts = readdirSync(SCRIPTS).filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4));
  for (const s of skills) {
    const hits = [];
    for (const script of scripts) {
      for (const sub of subcommands(script)) {
        if (s.body.includes(`\`${script} ${sub}`)) hits.push(`${script} ${sub}`);
      }
    }
    assert.deepEqual(hits, [], `${s.name}: use "sh \${CLAUDE_PLUGIN_ROOT}/scripts/run.sh …" for ${hits.join(', ')}`);
  }
});

test('every agent is used by a skill; doctor full uses the consistency reviewer with the file list', () => {
  const used = new Set();
  for (const s of skills) for (const [, name] of s.body.matchAll(/`(buggy:[a-z-]+)`/g)) used.add(name);
  for (const a of agents) assert.ok(used.has(`buggy:${a.data.name}`), `${a.file}: not used by any skill`);
  const doctor = skills.find((s) => s.name === 'doctor');
  assert.match(doctor.body, /run\.sh doctor context/);
  assert.match(doctor.body, /`buggy:consistency-reviewer`/);
});

test('commands injected into skills never exit non-zero (Claude Code would abort the skill)', (t) => {
  // Every !`…` in a skill: run it where it cannot succeed – outside git, and in a git repo without buggy.
  const injected = new Set();
  for (const s of skills) {
    for (const [, cmd] of s.body.matchAll(/!`sh \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/run\.sh ([^`]+)`/g)) injected.add(cmd);
  }
  assert.ok(injected.size >= 4, [...injected].join(', '));
  const plain = tempRepo(t);
  const outside = join(plain, '..', `outside-${process.pid}`);
  mkdirSync(outside, { recursive: true });
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  for (const cmd of injected) {
    for (const cwd of [outside, plain]) {
      const r = runScript(cmd.split(' ')[0], cmd.split(' ').slice(1), { cwd });
      assert.equal(r.code, 0, `${cmd} in ${cwd === plain ? 'a repo without buggy' : 'a folder without git'}: exit ${r.code} ${r.stdout}`);
      assert.ok(r.json && typeof r.json.status === 'string', `${cmd}: JSON output`);
    }
  }
});

test('the CLAUDE.md block names every buggy command except start', () => {
  const block = readFileSync(join(PLUGIN_ROOT, 'templates', 'claude-block.md'), 'utf8');
  for (const s of skills) {
    if (s.name === 'start') continue;
    assert.ok(block.includes(`/buggy:${s.name}\``), `claude-block.md: /buggy:${s.name}`);
  }
});

test('clarify and plan accept answers written into the file and re-read it', () => {
  for (const name of ['clarify', 'plan']) {
    const s = skills.find((x) => x.name === name);
    assert.match(s.body, /in the file\*\*/, `${name}: answers in the file`);
    assert.match(s.body, /read the file again/, `${name}: re-read before changing it`);
    assert.match(s.body, /Never overwrite their edits/, `${name}: keeps the user's edits`);
  }
});

test('skills that write change documents name the documents language', () => {
  for (const name of ['new-idea', 'clarify', 'plan', 'implement', 'review', 'ship']) {
    const s = skills.find((x) => x.name === name);
    assert.match(s.body, /`language\.docs`/, `${name}: language.docs`);
  }
  assert.match(skills.find((x) => x.name === 'implement').body, /Entries in `history\.md`.*documents language/, 'implement: history.md language');
});

test('review commits the round documents even when a round has no fixes', () => {
  const s = skills.find((x) => x.name === 'review');
  assert.match(s.body, /docs: review round <n> of <id>/);
});

test('release keeps artifacts out of the worktree before removing it', () => {
  const s = skills.find((x) => x.name === 'release');
  assert.match(s.body, /artifacts/);
  assert.match(s.body, /no artifact the user still needs is left only inside it/);
});

test('release never changes code and hands problems over to new-idea / new', () => {
  const s = skills.find((x) => x.name === 'release');
  assert.match(s.body, /A release never changes code/);
  assert.match(s.body, /\/buggy:new-idea/);
});

test('every skill: arguments do not set the conversation language; file language never does', () => {
  for (const s of skills) {
    assert.match(s.body, /arguments[^.]*do not count/, `${s.name}: arguments do not count`);
    assert.match(s.body, /never changes the language you talk in/, `${s.name}: file language`);
  }
});

test('clarify and plan treat work already on the change branch as part of the change', () => {
  for (const name of ['clarify', 'plan']) {
    const s = skills.find((x) => x.name === name);
    assert.match(s.body, /`change\.branchWork`/, `${name}: branchWork`);
    assert.match(s.body, /never call the change done or propose abandoning it/, `${name}: no abandoning`);
  }
});

test('release cleans its own temporary files after a successful release', () => {
  assert.match(skills.find((x) => x.name === 'release').body, /Delete the temporary files you wrote in `\.buggy\/\.tmp\/`/);
});
