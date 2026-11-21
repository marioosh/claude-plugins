// /buggy:start – project setup (D-7, D-8, D-9, D-28, D-29, D-31, D-33…D-35, stage 6).
// Works without .buggy/config.yaml (it creates it).

import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fail } from './cli.mjs';
import { exists, readText, writeText, resolveInside, ensureInputDirIgnored } from './fsutil.mjs';
import { git, repoRoot, headCommit, currentBranch, localBranches, versionTags, status, switchCreate, branchExists, mv } from './git.mjs';
import { normalize, CONFIG_PATH } from './config.mjs';
import { parse, stringify } from './yaml.mjs';
import { isValid as isVersion } from './semver.mjs';
import { today, todayIso, makeId, isValidId } from './ids.mjs';
import { effectiveHooksDir, activeHooks } from './githooks.mjs';
import { renderTemplate } from './templates.mjs';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'deps', '_build', 'vendor', 'target', 'dist', 'build', '.venv', 'venv', '__pycache__', '.idea', '.vscode', '.buggy']);
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.ex', '.exs', '.heex', '.go', '.rs', '.java', '.kt', '.scala', '.cs', '.php', '.swift', '.c', '.h', '.cpp', '.vue', '.svelte', '.dart', '.lua', '.sh']);
const MANIFESTS = ['package.json', 'mix.exs', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'Gemfile', 'composer.json', 'build.sbt', 'Makefile', 'Dockerfile'];
const WALK_LIMIT = 20000;

function walk(dir, rel = '', acc = { files: [], truncated: false }) {
  if (acc.files.length >= WALK_LIMIT) {
    acc.truncated = true;
    return acc;
  }
  let entries;
  try {
    entries = readdirSync(join(dir, rel), { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(dir, p, acc);
    } else if (e.isFile()) acc.files.push(p);
    if (acc.files.length >= WALK_LIMIT) {
      acc.truncated = true;
      break;
    }
  }
  return acc;
}

function readSmall(root, rel) {
  try {
    const p = join(root, rel);
    if (statSync(p).size > 512 * 1024) return null;
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

// Read-only inspection → which case (1.1 / 1.2 / 1.3 / existing) and the evidence.
export async function detect(cwd = process.cwd()) {
  const gitRoot = await repoRoot(cwd);
  const root = gitRoot ?? cwd;
  const out = { root, git: Boolean(gitRoot) };

  if (gitRoot) {
    out.hasCommits = (await headCommit(root)) !== null;
    out.branch = await currentBranch(root);
    out.origin = await git(['remote', 'get-url', 'origin'], { cwd: root, allowFail: true });
    const branches = await localBranches(root);
    out.mainCandidates = ['main', 'master', 'trunk', 'develop'].filter((b) => branches.includes(b));
    out.hooks = { hooksPath: await git(['config', '--get', 'core.hooksPath'], { cwd: root, allowFail: true }), active: activeHooks(await effectiveHooksDir(root)) };
  }

  const { files, truncated } = walk(root);
  out.files = files.length;
  out.filesTruncated = truncated;
  out.codeFiles = files.filter((f) => CODE_EXT.has(extname(f))).length;
  out.manifests = MANIFESTS.filter((m) => existsSync(join(root, m)));

  const top = (name) => existsSync(join(root, name));
  const sdd = [];
  for (const d of ['features', 'specs', '.specify', '.sherpa', 'releases', 'changes', 'docs/adr', 'adr', 'user_stories']) {
    if (top(d) && statSync(join(root, d)).isDirectory()) {
      const n = files.filter((f) => f.startsWith(`${d}/`)).length;
      sdd.push({ path: `${d}/`, files: n });
    }
  }
  for (const f of files.filter((p) => /(^|\/)(ROADMAP|CHANGELOG|SPEC|FUNCTIONAL_SPEC)[^/]*\.md$/i.test(p) && p.split('/').length <= 3)) {
    sdd.push({ path: f });
  }
  const versioned = files.filter((f) => /(^|\/)\d+\.\d+\.\d+[^/]*\.md$/.test(f)).length;
  if (versioned) sdd.push({ path: '(version-named documents)', files: versioned });
  out.sddMarkers = sdd;

  const versions = [];
  const vt = readSmall(root, 'version.txt');
  if (vt !== null) versions.push({ source: 'version.txt', value: vt.trim() });
  const pkg = readSmall(root, 'package.json');
  if (pkg) {
    try {
      const v = JSON.parse(pkg).version;
      if (typeof v === 'string') versions.push({ source: 'package.json', value: v, key: 'version' });
    } catch {
      // ignore
    }
  }
  const mix = readSmall(root, 'mix.exs');
  if (mix) {
    const m = mix.match(/version:\s*"(\d+\.\d+\.\d+)"/);
    if (m) versions.push({ source: 'mix.exs', value: m[1], note: 'hard-coded; buggy needs version.txt or a JSON file' });
    else if (/version\.txt/.test(mix)) versions.push({ source: 'mix.exs', value: null, note: 'reads version.txt' });
  }
  const py = readSmall(root, 'pyproject.toml');
  if (py) {
    const m = py.match(/^version\s*=\s*"(\d+\.\d+\.\d+)"/m);
    if (m) versions.push({ source: 'pyproject.toml', value: m[1], note: 'buggy needs version.txt or a JSON file' });
  }
  if (gitRoot) {
    const t = (await versionTags(root))[0];
    if (t) versions.push({ source: 'tag', value: t.slice(1) });
  }
  out.versionCandidates = versions.map((v) => ({ ...v, valid: v.value === null || isVersion(v.value) }));

  const claude = {
    claudeMd: top('CLAUDE.md'),
    agentsMd: top('AGENTS.md'),
    skills: top('.claude/skills') ? readdirSync(join(root, '.claude/skills')).filter((n) => !n.startsWith('.')) : [],
    agents: top('.claude/agents') ? readdirSync(join(root, '.claude/agents')).filter((n) => n.endsWith('.md')) : [],
    settings: top('.claude/settings.json'),
    allowRules: 0,
  };
  if (claude.settings) {
    try {
      claude.allowRules = JSON.parse(readSmall(root, '.claude/settings.json') ?? '{}')?.permissions?.allow?.length ?? 0;
    } catch {
      // ignore
    }
  }
  if (claude.claudeMd) claude.buggyBlock = (readSmall(root, 'CLAUDE.md') ?? '').includes(BLOCK_BEGIN);
  out.claude = claude;
  out.buggy = top(CONFIG_PATH);

  out.proposedCase = out.buggy
    ? 'existing'
    : sdd.length
      ? '1.3'
      : out.codeFiles > 0 || out.manifests.length
        ? '1.2'
        : '1.1';
  return out;
}

// ---------- branch, config ----------

export async function setupBranch(root, mainBranch) {
  if (!(await headCommit(root))) fail('no-commits', 'The repository has no commits yet: the user makes the first commit on the main branch.');
  if (!(await branchExists(root, mainBranch))) fail('branch-missing', `Branch ${mainBranch} does not exist.`);
  const dirty = (await status(root)).map((e) => e.path);
  if (dirty.length) fail('dirty-tree', 'Commit or put aside the uncommitted changes first.', { files: dirty });
  const existing = (await localBranches(root)).filter((b) => b.startsWith('chore/')).map((b) => b.slice(6));
  const branch = `chore/${makeId(today(), 'buggy-setup', existing)}`;
  await switchCreate(root, branch, mainBranch);
  return { branch, base: mainBranch };
}

export function initConfig(root, input = {}) {
  if (exists(root, CONFIG_PATH)) fail('already-set-up', 'buggy is already set up here (.buggy/config.yaml exists).');
  const raw = { buggy: 1, main_branch: input.mainBranch ?? 'main', version: { file: input.version?.file ?? 'version.txt' }, language: input.language ?? {} };
  if (input.version?.key) raw.version.key = input.version.key;
  const config = normalize(raw); // validation – throws bad-config
  const lang = { docs: config.language.docs, code: config.language.code, commits: config.language.commits, exceptions: config.language.exceptions };
  const text = `# buggy project configuration – see the buggy documentation (docs/development.md).\n${stringify({ ...raw, language: lang })}`;
  normalize(parse(text)); // round trip
  writeText(root, CONFIG_PATH, text, { exclusive: true });
  ensureInputDirIgnored(root);
  const created = [CONFIG_PATH, '.buggy/.gitignore'];

  let version = null;
  if (!exists(root, config.version.file)) {
    if (config.version.format === 'json') fail('version-file-missing', `${config.version.file} does not exist.`);
    version = input.initialVersion ?? '0.0.0';
    if (!isVersion(version)) fail('bad-version', `Not a version (X.Y.Z): ${version}`);
    writeText(root, config.version.file, `${version}\n`);
    created.push(config.version.file);
  }
  return { created, config, versionWritten: version };
}

// ---------- CLAUDE.md block ----------

export const BLOCK_BEGIN = '<!-- buggy:begin -->';
export const BLOCK_END = '<!-- buggy:end -->';

// The block as the current plugin version writes it (doctor compares CLAUDE.md with it).
export function claudeBlockText(root) {
  return `${BLOCK_BEGIN}\n${renderTemplate(root, 'claude-block.md', {}).text.trim()}\n${BLOCK_END}`;
}

export function claudeBlock(root) {
  const block = claudeBlockText(root);
  if (!exists(root, 'CLAUDE.md')) {
    writeText(root, 'CLAUDE.md', `# Project guide for Claude\n\n${block}\n`);
    return { result: 'created' };
  }
  const text = readText(root, 'CLAUDE.md');
  const a = text.indexOf(BLOCK_BEGIN);
  const b = text.indexOf(BLOCK_END);
  if (a === -1 || b === -1 || b < a) {
    if (a !== -1 || b !== -1) fail('bad-block', 'CLAUDE.md has only one of the buggy markers – fix it by hand.');
    writeText(root, 'CLAUDE.md', `${text.replace(/\n*$/, '\n\n')}${block}\n`);
    return { result: 'appended' };
  }
  const updated = `${text.slice(0, a)}${block}${text.slice(b + BLOCK_END.length)}`;
  if (updated === text) return { result: 'unchanged' };
  writeText(root, 'CLAUDE.md', updated);
  return { result: 'updated' };
}

// ---------- moves and stubs (D-33, stage 6 P7) ----------

export async function moveAll(root, moves) {
  if (!Array.isArray(moves) || moves.length === 0) fail('bad-input', 'moves must be a non-empty list of {from, to}.');
  for (const m of moves) {
    if (typeof m?.from !== 'string' || typeof m?.to !== 'string') fail('bad-input', 'Every move needs from and to.');
    resolveInside(root, m.from);
    resolveInside(root, m.to);
    if (!existsSync(join(root, m.from))) fail('not-found', `Nothing to move: ${m.from}`);
    if (existsSync(join(root, m.to))) fail('already-exists', `Target exists: ${m.to}`);
    // An idea must be ideas/<YYYYMMDD-name>.md, or buggy will not recognise it (D-2, D-6).
    const idea = m.to.match(/^ideas\/([^/]+)\.md$/);
    if (m.to.startsWith('ideas/') && (!idea || !isValidId(idea[1]))) {
      fail('bad-idea-name', `Ideas are named ideas/YYYYMMDD-name.md (date without dashes, lower-case name): ${m.to}`);
    }
  }
  for (const m of moves) await mv(root, m.from, m.to);
  return { moved: moves.length };
}

export function writeStubs(root, stubs) {
  if (!Array.isArray(stubs) || stubs.length === 0) fail('bad-input', 'stubs must be a non-empty list of {path, target}.');
  const date = todayIso();
  for (const s of stubs) {
    if (typeof s?.path !== 'string' || typeof s?.target !== 'string') fail('bad-input', 'Every stub needs path and target.');
    if (exists(root, s.path)) fail('already-exists', `${s.path} exists – a stub is written only where a file was moved away.`);
    writeText(root, s.path, `# Moved\n\nThis document moved to \`${s.target}\` on ${date} (buggy setup).\n`);
  }
  return { written: stubs.map((s) => s.path) };
}
