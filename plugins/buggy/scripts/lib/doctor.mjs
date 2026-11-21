// /buggy:doctor – quick, script-only checks (D-21, stage 5 P10). Read-only: it
// reports problems with a proposed fix and never changes anything itself.
//
// Finding: { level: 'error' | 'warning' | 'info', code, message, fix? }

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { exists, readText, listDir } from './fsutil.mjs';
import { git, branchExists, versionTags, tagCommit, show, currentBranch, localBranches } from './git.mjs';
import { loadConfig } from './config.mjs';
import { readVersion, readVersionAt, mainVersion } from './version.mjs';
import { isValid as isVersion, compare } from './semver.mjs';
import { listChanges, loadChange, idFromBranch, specPath } from './change.mjs';
import { planPath } from './plan.mjs';
import { historyPath } from './history.mjs';
import { reviewPath } from './review.mjs';
import { isValidId } from './ids.mjs';
import { splitFrontmatter } from './yaml.mjs';
import { checkHooks, hookVersion } from './githooks.mjs';
import { claudeBlockText, BLOCK_BEGIN, BLOCK_END } from './setup.mjs';

export const STALE_DAYS = 30;
const NEEDS_PLAN = ['planned', 'implementing', 'implemented', 'in-review', 'approved'];
const NEEDS_HISTORY = ['implementing', 'implemented', 'in-review', 'approved'];
const NEEDS_REVIEW = ['in-review', 'approved'];

async function attempt(out, code, fn) {
  try {
    await fn();
  } catch (err) {
    out.push({ level: 'error', code, message: err.message });
  }
}

export async function runDoctor(root, { now = Date.now() } = {}) {
  const out = [];
  const add = (level, code, message, fix) => out.push(fix ? { level, code, message, fix } : { level, code, message });

  // ---------- config ----------
  let config = null;
  try {
    config = loadConfig(root);
  } catch (err) {
    add('error', 'config-invalid', `.buggy/config.yaml: ${err.message}`, 'Correct the file (see the buggy documentation for the format).');
  }
  if (!config) return summarize(out);
  const main = config.mainBranch;
  const gi = exists(root, '.buggy/.gitignore') ? readText(root, '.buggy/.gitignore') : '';
  if (!gi.split(/\r?\n/).some((l) => l.trim() === '.tmp/' || l.trim() === '.tmp')) {
    add('warning', 'gitignore-tmp', '.buggy/.gitignore does not ignore .tmp/ (buggy\'s input and diff files).', 'Add the line ".tmp/" to .buggy/.gitignore.');
  }
  if (!(await branchExists(root, main))) add('error', 'main-missing', `The main branch "${main}" does not exist.`, 'Correct main_branch in .buggy/config.yaml or create the branch.');

  // ---------- versions (D-27) ----------
  let mainV = null;
  await attempt(out, 'version-invalid', async () => {
    mainV = await mainVersion(root, config);
    const wt = readVersion(root, config);
    if (wt === null && mainV !== '0.0.0') add('warning', 'version-file-missing', `${config.version.file} is missing in the working tree.`);
  });
  const sources = [];
  if (existsSync(join(root, 'version.txt'))) sources.push(['version.txt', readText(root, 'version.txt').trim()]);
  if (existsSync(join(root, 'package.json'))) {
    try {
      const v = JSON.parse(readText(root, 'package.json')).version;
      if (typeof v === 'string') sources.push(['package.json', v]);
    } catch {
      // not our business
    }
  }
  // A manifest that holds its own literal version (instead of reading the version file):
  // /buggy:ship bumps only the version file, so the build would keep the old number.
  for (const [file, v] of hardcodedVersions(root)) {
    if (file === config.version.file) continue;
    sources.push([file, v]);
    add('warning', 'version-hardcoded', `${file} holds its own version (${v}); /buggy:ship updates only ${config.version.file}.`, file === 'mix.exs'
      ? `Make mix.exs read the version file: version: __DIR__ |> Path.join("${config.version.file}") |> File.read!() |> String.trim() (__DIR__ keeps it working from umbrella apps and any working directory) – a code change, commit it through the preview.`
      : `Make ${file} read its version from ${config.version.file} (a dynamic version of the build backend) – a code change, commit it through the preview.`);
  }
  const distinct = new Set(sources.filter(([, v]) => isVersion(v)).map(([, v]) => v));
  if (distinct.size > 1) {
    add('warning', 'version-sources-differ', `Version sources disagree: ${sources.map(([f, v]) => `${f}=${v}`).join(', ')}.`, `Keep them equal (the source of truth is ${config.version.file}).`);
  }
  const tags = await versionTags(root);
  if (mainV && mainV !== '0.0.0') {
    const tagged = await tagCommit(root, `v${mainV}`);
    if (!tagged) add('warning', 'main-untagged', `Version ${mainV} on ${main} has no tag v${mainV}.`, 'Run /buggy:ship on the main branch (it can tag now) or check the git hooks.');
    else if ((await git(['merge-base', '--is-ancestor', tagged, main], { cwd: root, allowFail: true })) === null) {
      add('error', 'tag-not-on-main', `Tag v${mainV} points to a commit that is not in ${main}.`, 'Move or delete the tag by hand after checking which commit is right.');
    }
    const latest = tags[0];
    if (latest && compare(latest.slice(1), mainV) > 0) {
      add('warning', 'tag-ahead', `The newest tag ${latest} is newer than the version on ${main} (${mainV}).`, 'A release may be missing on the main branch, or the tag is wrong.');
    }
  }
  if ((await currentBranch(root)) === main && exists(root, '.githooks/buggy-tag.sh')) {
    await attempt(out, 'hook-version', async () => {
      const fromHook = await hookVersion(root);
      const fromNode = await readVersionAt(root, config, 'HEAD');
      if ((fromHook ?? null) !== (fromNode ?? null)) {
        add('error', 'hook-version-mismatch', `The git hook reads version "${fromHook}" but buggy reads "${fromNode}" from ${config.version.file}.`, 'Keep the version as a plain "key": "X.Y.Z" entry, or reinstall the hooks.');
      }
    });
  }

  // ---------- hooks (D-3, D-31) ----------
  await attempt(out, 'hooks-check', async () => {
    const h = await checkHooks(root, config);
    if (!h.installed) {
      add('warning', 'hooks-not-installed', `Git hooks: ${h.problems.join(' ')}`, h.managers.length
        ? `Add the call to ${h.managers.join(', ')} (post-merge, post-commit) and run githooks install --mode append.`
        : 'Install them: githooks install (fresh when no other hooks are active, otherwise append); every clone needs core.hooksPath once.');
    }
  });
  if ((await show(root, main, '.buggy/config.yaml')) !== null && !(await tagCommit(root, 'buggy-init'))) {
    add('info', 'buggy-init-missing', 'The tag buggy-init is missing.', 'It is created by the git hook on the main branch (or githooks tag-now).');
  }

  // ---------- changes ----------
  for (const c of listChanges(root)) {
    if (c.error) {
      add('error', 'change-broken', `changes/${c.id}: ${c.error}`, 'Fix the folder name or the frontmatter of spec.md.');
      continue;
    }
    const ch = loadChange(root, c.id);
    const st = ch.meta.status;
    if (st === 'shipped') add('error', 'change-shipped-not-moved', `changes/${c.id} is shipped but still in changes/.`, 'Move it to releases/X.Y.Z-<name>/ (git mv) – ship normally does this.');
    if (NEEDS_PLAN.includes(st) && !exists(root, planPath(c.id))) add('error', 'change-plan-missing', `${c.id} is ${st} but has no plan.md.`);
    if (NEEDS_HISTORY.includes(st) && !exists(root, historyPath(c.id))) add('warning', 'change-history-missing', `${c.id} is ${st} but has no history.md.`);
    if (NEEDS_REVIEW.includes(st) && !exists(root, reviewPath(c.id))) add('error', 'change-review-missing', `${c.id} is ${st} but has no review.md.`);
    if (ch.specChanged && ['clarified', 'planned'].includes(st)) add('warning', 'change-spec-changed', `${c.id}: the spec changed after clarification.`, 'Run /buggy:clarify again.');
    if (st !== 'abandoned' && st !== 'shipped' && !(await branchExists(root, `feature/${c.id}`))) {
      add('warning', 'change-no-branch', `${c.id} has no branch feature/${c.id}.`);
    }
  }

  // Changes in progress live on their own branches (not visible from main):
  // every feature/<id> branch not merged into main, with its spec read from the branch.
  for (const branch of await localBranches(root)) {
    const id = idFromBranch(branch);
    if (!id) continue;
    if ((await git(['merge-base', '--is-ancestor', branch, main], { cwd: root, allowFail: true })) !== null) continue;
    const text = await show(root, branch, specPath(id));
    let st = null;
    try {
      st = text ? splitFrontmatter(`${text}\n`).data?.status : null;
    } catch {
      st = null;
    }
    if (!st || st === 'abandoned' || st === 'shipped') continue;
    const last = Number(await git(['log', '-1', '--format=%ct', branch], { cwd: root })) * 1000;
    const days = Math.floor((now - last) / 86_400_000);
    if (days >= STALE_DAYS) {
      add('info', 'change-stale', `${id} (${st}, branch ${branch}) has had no commits for ${days} days.`, 'Continue it, or abandon it with a reason (status abandoned, D-30).');
    }
  }

  // ---------- releases ----------
  for (const dir of listDir(root, 'releases', { dirs: true })) {
    const m = dir.match(/^(\d+\.\d+\.\d+)-[a-z0-9]+(-[a-z0-9]+)*$/);
    if (!m) {
      add('warning', 'release-bad-folder', `releases/${dir} does not look like X.Y.Z-<name>.`);
      continue;
    }
    const path = `releases/${dir}/spec.md`;
    if (!exists(root, path)) {
      add('warning', 'release-spec-missing', `releases/${dir} has no spec.md.`);
      continue;
    }
    let meta = null;
    try {
      meta = splitFrontmatter(readText(root, path)).data;
    } catch (err) {
      add('error', 'release-broken', `${path}: ${err.message}`);
      continue;
    }
    if (!meta || meta.status !== 'shipped' || meta.version !== m[1]) {
      add('error', 'release-version-mismatch', `${path} is not marked shipped as ${m[1]} (status ${meta?.status}, version ${meta?.version}).`);
    }
    if (!(await tagCommit(root, `v${m[1]}`))) add('warning', 'release-untagged', `Release ${m[1]} has no tag v${m[1]}.`, 'Tag the commit that shipped it (git tag -a) after checking which one it is.');
  }

  // ---------- CLAUDE.md block (written by an older plugin version?) ----------
  if (exists(root, 'CLAUDE.md')) {
    const text = readText(root, 'CLAUDE.md');
    const a = text.indexOf(BLOCK_BEGIN);
    const b = text.indexOf(BLOCK_END);
    if (a !== -1 && b > a && text.slice(a, b + BLOCK_END.length) !== claudeBlockText(root)) {
      add('info', 'claude-block-outdated', 'The buggy block in CLAUDE.md differs from the one this plugin version writes.', 'Refresh it with setup claude-block (after a look at the difference) and commit CLAUDE.md through the preview.');
    }
  }

  // ---------- ideas, leftovers ----------
  for (const f of listDir(root, 'ideas', { files: true })) {
    if (!f.endsWith('.md') || !isValidId(f.slice(0, -3))) add('warning', 'idea-bad-name', `ideas/${f} does not look like YYYYMMDD-name.md.`);
  }
  const tmp = join(root, '.buggy', '.tmp');
  if (existsSync(tmp) && statSync(tmp).isDirectory()) {
    const left = readdirSync(tmp);
    if (left.length) add('info', 'tmp-leftovers', `.buggy/.tmp has ${left.length} leftover file(s).`, 'Safe to delete when no buggy command is running.');
  }
  return summarize(out);
}

function summarize(findings) {
  const count = (l) => findings.filter((f) => f.level === l).length;
  return { ok: count('error') === 0, errors: count('error'), warnings: count('warning'), infos: count('info'), findings };
}

// ---------- context for `doctor full` (stage 7 P6–P7) ----------

const MANIFESTS = [
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'mix.exs', 'mix.lock', 'pyproject.toml', 'poetry.lock',
  'requirements.txt', 'Cargo.toml', 'Cargo.lock', 'go.mod', 'go.sum', 'Gemfile', 'Gemfile.lock', 'composer.json', 'composer.lock',
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'build.sbt', 'Dockerfile',
];
export const RECENT_RELEASES = 3;

// Files the consistency reviewer reads: knowledge, manifests, Claude files and
// the specs + release notes of the most recent releases.
export function doctorContext(root) {
  const knowledge = listDir(root, '.buggy', { files: true }).filter((f) => f.endsWith('.md')).map((f) => `.buggy/${f}`);
  const manifests = MANIFESTS.filter((m) => exists(root, m));
  const claude = ['CLAUDE.md', 'AGENTS.md'].filter((m) => exists(root, m));
  const releases = listDir(root, 'releases', { dirs: true })
    .map((d) => ({ dir: d, m: d.match(/^(\d+)\.(\d+)\.(\d+)-/) }))
    .filter((x) => x.m)
    .sort((a, b) => b.m[1] - a.m[1] || b.m[2] - a.m[2] || b.m[3] - a.m[3])
    .slice(0, RECENT_RELEASES)
    .map((x) => ({
      version: `${x.m[1]}.${x.m[2]}.${x.m[3]}`,
      files: ['spec.md', 'release-note.md'].map((f) => `releases/${x.dir}/${f}`).filter((p) => exists(root, p)),
    }));
  return { knowledge, manifests, claude, releases };
}

// Literal versions in the root mix.exs (inside `def project`) and pyproject.toml.
export function hardcodedVersions(root) {
  const out = [];
  if (existsSync(join(root, 'mix.exs'))) {
    const text = readText(root, 'mix.exs');
    const start = text.search(/\bdef project\b/);
    if (start !== -1) {
      const rest = text.slice(start);
      const end = rest.slice(1).search(/\n\s*defp? /);
      const block = end === -1 ? rest : rest.slice(0, end + 1);
      // The project's own `version:` entry starts a line; nested ones (e.g. ERTS) do not.
      const entry = block.match(/^[ \t]*version:\s*(.*)$/m);
      const m = entry && entry[1].match(/^"(\d+\.\d+\.\d+[^"]*)"/);
      if (m) out.push(['mix.exs', m[1]]);
    }
  }
  if (existsSync(join(root, 'pyproject.toml'))) {
    const m = readText(root, 'pyproject.toml').match(/^version\s*=\s*"(\d+\.\d+\.\d+[^"]*)"/m);
    if (m) out.push(['pyproject.toml', m[1]]);
  }
  return out;
}
