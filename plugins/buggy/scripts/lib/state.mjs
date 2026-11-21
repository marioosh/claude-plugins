// Project state: what every skill and the SessionStart hook need to know.
// Never throws: every partial failure becomes a warning.

import { repoRoot, currentBranch, isClean, branchExists, gitVersion, git } from './git.mjs';
import { loadConfig } from './config.mjs';
import { readVersion, mainVersion, latestTag } from './version.mjs';
import { loadChange, listChanges, idFromBranch, findShipped, specPath } from './change.mjs';
import { bump } from './semver.mjs';
import { exists, readText } from './fsutil.mjs';
import { planPath, progress } from './plan.mjs';
import { reviewPath, reviewSummary } from './review.mjs';
import { checkHooks } from './githooks.mjs';

const MIN_NODE_MAJOR = 20;
const MIN_GIT = { major: 2, minor: 23 }; // git switch

export const NEXT = {
  draft: '/buggy:clarify',
  clarified: '/buggy:plan',
  planned: '/buggy:implement',
  implementing: '/buggy:implement',
  implemented: '/buggy:review',
  'in-review': '/buggy:review',
  approved: '/buggy:ship',
  shipped: null,
  abandoned: null,
};

async function safe(warnings, label, fn, fallback = null) {
  try {
    return await fn();
  } catch (err) {
    warnings.push(`${label}: ${err.message}`);
    return fallback;
  }
}

export async function computeState(cwd = process.cwd()) {
  const warnings = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < MIN_NODE_MAJOR) warnings.push(`Node ${process.versions.node} is older than ${MIN_NODE_MAJOR}.`);
  const gv = await gitVersion();
  if (!gv) warnings.push('git was not found.');
  else if (gv.major < MIN_GIT.major || (gv.major === MIN_GIT.major && gv.minor < MIN_GIT.minor)) {
    warnings.push(`git ${gv.major}.${gv.minor} is older than ${MIN_GIT.major}.${MIN_GIT.minor}.`);
  }

  const root = await repoRoot(cwd);
  if (!root) return { buggy: false, git: false, root: null, warnings };

  const branch = await currentBranch(root);
  const base = { git: true, root, branch, clean: await safe(warnings, 'git status', () => isClean(root)) };

  const config = await safe(warnings, '.buggy/config.yaml', () => loadConfig(root));
  if (!config) return { buggy: false, ...base, warnings };

  const main = config.mainBranch;
  if (!(await branchExists(root, main))) warnings.push(`Main branch "${main}" does not exist yet.`);

  const mainV = await safe(warnings, 'version on main', () => mainVersion(root, config), null);
  const tag = await safe(warnings, 'tags', () => latestTag(root));
  const version = {
    file: config.version.file,
    main: mainV,
    workingTree: await safe(warnings, 'version file', () => readVersion(root, config)),
    latestTag: tag,
    mainTagged: mainV !== null && tag === `v${mainV}`,
  };
  const hooks = await safe(warnings, 'git hooks', () => checkHooks(root, config));
  if (hooks && !hooks.installed) {
    warnings.push('The buggy git hooks are not installed in this clone – version tags will not be created after merges (/buggy:doctor).');
  }
  if (mainV && mainV !== '0.0.0' && !version.mainTagged) {
    warnings.push(`Version ${mainV} on ${main} has no tag v${mainV} (is the buggy git hook installed?).`);
  }

  let change = null;
  const id = idFromBranch(branch);
  const shipped = id && !exists(root, specPath(id)) ? findShipped(root, id) : null;
  if (shipped) {
    change = {
      id,
      title: shipped.meta.title,
      status: shipped.meta.status,
      change: shipped.meta.change,
      version: shipped.meta.version,
      release: shipped.dir,
      next: `merge ${branch} into ${main} (the user does it), then /buggy:ship on ${main}`,
    };
  } else if (id) {
    change = await safe(warnings, `change ${id}`, () => {
      const c = loadChange(root, id);
      const m = c.meta;
      const reclarify = c.specChanged && ['clarified', 'planned'].includes(m.status);
      return {
        id,
        title: m.title,
        status: m.status,
        change: m.change,
        baseVersion: m.base_version,
        wouldBe: mainV ? bump(mainV, m.change) : null,
        mainMoved: mainV !== null && m.base_version !== mainV,
        specChanged: c.specChanged,
        progress: exists(root, planPath(id)) ? progress(readText(root, planPath(id))) : null,
        review: exists(root, reviewPath(id)) ? reviewSummary(readText(root, reviewPath(id))) : null,
        next: reclarify ? '/buggy:clarify' : NEXT[m.status],
      };
    });
  }

  // Work already on the change branch besides the change's own documents (e.g. commits
  // merged in from elsewhere): it belongs to this change (stage 9, problem 14).
  if (change && !change.release) {
    change.branchWork = await safe(warnings, 'branch work', () => branchWork(root, main, id), null);
  }

  const changes = (await safe(warnings, 'changes', () => listChanges(root), [])).filter(
    (c) => c.error || !['shipped', 'abandoned'].includes(c.status),
  );
  for (const c of changes) if (c.error) warnings.push(`changes/${c.id}: ${c.error}`);

  return {
    buggy: true,
    ...base,
    mainBranch: main,
    language: config.language,
    version,
    change,
    changes,
    warnings,
  };
}

const BRANCH_FILES_MAX = 40;

// Committed work on the change branch since it left the main branch, without the
// change's own folder: { commits, files (at most BRANCH_FILES_MAX), filesCount }.
export async function branchWork(root, main, id) {
  const base = await git(['merge-base', main, 'HEAD'], { cwd: root, allowFail: true });
  if (!base) return null;
  const exclude = [`:(exclude)changes/${id}`];
  const files = (await git(['diff', '--name-only', base, 'HEAD', '--', '.', ...exclude], { cwd: root })).split('\n').filter(Boolean);
  const commits = (await git(['rev-list', '--count', `${base}..HEAD`, '--', '.', ...exclude], { cwd: root })).trim();
  return { commits: Number(commits), files: files.slice(0, BRANCH_FILES_MAX), filesCount: files.length };
}

