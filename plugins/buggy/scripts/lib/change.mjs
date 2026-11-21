// Changes: `changes/<id>/` folders whose `spec.md` frontmatter is the single
// source of a change's state (design §4.1–4.2).

import { createHash } from 'node:crypto';
import { fail } from './cli.mjs';
import { exists, readText, writeText, listDir } from './fsutil.mjs';
import { splitFrontmatter, joinFrontmatter } from './yaml.mjs';
import { renderTemplate } from './templates.mjs';
import { today, todayIso, slugify, makeId, assertId, isValidId } from './ids.mjs';
import { CHANGE_KINDS, isValid as isVersion } from './semver.mjs';
import { localBranches, mv } from './git.mjs';
import { ideaPath } from './ideas.mjs';

import { CHANGES_DIR, BRANCH_PREFIX, changeDir, specPath, branchFor } from './change-paths.mjs';
import { loadPlan, checkSteps, progress } from './plan.mjs';
import { loadReview, approvalGate } from './review.mjs';

export { CHANGES_DIR, BRANCH_PREFIX, changeDir, specPath, branchFor };

export const STATUSES = [
  'draft',
  'clarified',
  'planned',
  'implementing',
  'implemented',
  'in-review',
  'approved',
  'shipped',
  'abandoned',
];

// Allowed transitions. `abandoned` is reachable from every status before `shipped`.
export const TRANSITIONS = {
  draft: ['clarified'],
  clarified: ['clarified', 'planned'],
  planned: ['clarified', 'implementing'],
  implementing: ['implemented'],
  implemented: ['implementing', 'in-review'],
  'in-review': ['approved'],
  approved: ['in-review', 'shipped'],
  shipped: [],
  abandoned: [],
};
for (const s of STATUSES) if (s !== 'shipped' && s !== 'abandoned') TRANSITIONS[s].push('abandoned');


export function idFromBranch(branch) {
  if (typeof branch !== 'string' || !branch.startsWith(BRANCH_PREFIX)) return null;
  const id = branch.slice(BRANCH_PREFIX.length);
  return isValidId(id) ? id : null;
}

// Hash of the specification text (frontmatter excluded); line endings and
// trailing whitespace do not count as changes.
export function specHash(body) {
  const norm = body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .trim();
  return createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

function validateMeta(meta, id) {
  if (!meta) fail('bad-spec', `${specPath(id)} has no frontmatter.`);
  if (meta.id !== id) fail('bad-spec', `${specPath(id)}: id "${meta.id}" does not match the folder.`);
  if (!STATUSES.includes(meta.status)) fail('bad-spec', `${specPath(id)}: unknown status "${meta.status}".`);
  if (!CHANGE_KINDS.includes(meta.change)) fail('bad-spec', `${specPath(id)}: unknown change kind "${meta.change}".`);
}

export function loadChange(root, id) {
  assertId(id);
  if (!exists(root, specPath(id))) fail('change-not-found', `Change not found: ${id}`);
  const text = readText(root, specPath(id));
  const { data, body } = splitFrontmatter(text);
  validateMeta(data, id);
  const specChanged = data.spec_hash ? specHash(body) !== data.spec_hash : false;
  return { id, dir: changeDir(id), meta: data, body, specChanged };
}

// All changes in `changes/` of the working tree. Broken ones are reported, not thrown.
export function listChanges(root) {
  const out = [];
  for (const name of listDir(root, CHANGES_DIR, { dirs: true })) {
    if (!isValidId(name)) {
      out.push({ id: name, error: 'Folder name is not a valid change id.' });
      continue;
    }
    try {
      const c = loadChange(root, name);
      out.push({ id: c.id, title: c.meta.title, status: c.meta.status, change: c.meta.change, branch: c.meta.branch, specChanged: c.specChanged });
    } catch (err) {
      out.push({ id: name, error: err.message });
    }
  }
  return out;
}

// Id for a new change: today's date + slug of the title; unique against
// existing change folders and `feature/` branches.
export async function newChangeId(root, title, date = today()) {
  const existing = new Set(listDir(root, CHANGES_DIR, { dirs: true }));
  for (const b of await localBranches(root)) {
    const id = idFromBranch(b);
    if (id) existing.add(id);
  }
  return makeId(date, slugify(title), [...existing]);
}

// Idea text placed in the specification: its own H1 title is dropped and every
// heading is demoted by one level, so it fits under "## Idea".
export function ideaSection(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const h1 = lines.findIndex((l) => /^#[ \t]+/.test(l));
  if (h1 !== -1) lines.splice(h1, 1);
  const body = lines
    .map((l) => (/^#{1,5}[ \t]/.test(l) ? `#${l}` : l))
    .join('\n')
    .trim();
  return `## Idea\n\n${body}\n`;
}

// Creates changes/<id>/spec.md (frontmatter + spec template).
// With `idea` ({id, text, inWorkingTree}): an idea in the working tree is moved
// with `git mv`, and the pure rename is committed first through `commitRename`
// (git only recognises a rename when the content is similar, so writing the
// spec in the same commit would cut the idea's history – D-6). An idea that
// exists only on another branch is copied. The idea text goes into an
// "## Idea" section (P3). A `description` (the user's short description from
// /buggy:new, D-4) is placed word for word in the "## Goal" section.
export async function createChange(root, { id, title, change, baseVersion, idea = null, description = null, created = today(), commitRename = null }) {
  assertId(id);
  if (typeof title !== 'string' || title.trim() === '') fail('bad-input', 'title is required.');
  if (description !== null && typeof description !== 'string') fail('bad-input', 'description must be text.');
  if (!CHANGE_KINDS.includes(change)) fail('bad-change-kind', `change must be one of ${CHANGE_KINDS.join(', ')}.`);
  if (!isVersion(baseVersion)) fail('bad-version', `Invalid base version: ${baseVersion}`);
  if (idea !== null) assertId(idea.id);
  if (exists(root, changeDir(id))) fail('change-exists', `Change already exists: ${id}`);

  const createdIso = `${created.slice(0, 4)}-${created.slice(4, 6)}-${created.slice(6, 8)}`;
  const meta = {
    id,
    title: title.trim(),
    change,
    base_version: baseVersion,
    status: 'draft',
    branch: branchFor(id),
    created: createdIso,
    from_idea: idea ? idea.id : null,
    spec_hash: null,
    version: null,
    shipped: null,
  };
  let body = renderTemplate(root, 'spec.md', { title: meta.title, id }).text;
  if (description && description.trim()) {
    const goal = body.indexOf('## Goal');
    if (goal === -1) fail('bad-template', 'The spec template has no "## Goal" section.');
    const end = body.indexOf('\n## ', goal + 1);
    const at = end === -1 ? body.length : end;
    body = `${body.slice(0, at).replace(/\n*$/, '\n\n')}${description.trim()}\n${body.slice(at)}`;
  }
  let moved = false;
  if (idea) {
    // Insert the idea right after the title line.
    const nl = body.indexOf('\n');
    body = `${body.slice(0, nl + 1)}\n${ideaSection(idea.text)}${body.slice(nl + 1)}`;
    if (idea.inWorkingTree) {
      await mv(root, ideaPath(idea.id), specPath(id));
      if (commitRename) await commitRename([ideaPath(idea.id), specPath(id)]);
      moved = true;
    }
  }
  writeText(root, specPath(id), joinFrontmatter(meta, body), { exclusive: !moved });
  return { id, dir: changeDir(id), meta, ideaMoved: moved };
}

// Status transition with its side effects on the frontmatter. The body is kept byte for byte.
export function setStatus(root, id, to, { reason, version, date } = {}) {
  const c = loadChange(root, id);
  const from = c.meta.status;
  if (!STATUSES.includes(to)) fail('bad-status', `Unknown status: ${to}`);
  if (!TRANSITIONS[from].includes(to)) {
    fail('bad-transition', `Cannot change status from "${from}" to "${to}".`, { from, to, allowed: TRANSITIONS[from] });
  }
  const meta = { ...c.meta, status: to };
  if (to === 'clarified') meta.spec_hash = specHash(c.body);
  if (to === 'planned' && c.specChanged) {
    fail('spec-changed', 'The specification changed after clarification. Run clarify again.');
  }
  if (to === 'planned') {
    const check = checkSteps(loadPlan(root, id));
    if (!check.ok) fail('plan-invalid', `The plan is not ready: ${check.problems.join(' ')}`, { problems: check.problems });
  }
  if (to === 'approved') {
    const gate = approvalGate(loadReview(root, id));
    if (!gate.ok) fail('review-open', `The review is not finished: ${gate.problems.join(' ')}`, { problems: gate.problems });
  }
  if (to === 'implemented') {
    const p = progress(loadPlan(root, id));
    if (p.total === 0 || p.done < p.total) {
      fail('steps-open', `Not all plan steps are done (${p.done}/${p.total}).`, p);
    }
  }
  if (to === 'abandoned') {
    if (typeof reason !== 'string' || reason.trim() === '') fail('bad-input', 'A reason is required to abandon a change.');
    meta.abandoned = date ?? todayIso();
    meta.abandon_reason = reason.trim();
  }
  if (to === 'shipped') {
    if (!isVersion(version)) fail('bad-version', 'A version X.Y.Z is required to ship.');
    meta.version = version;
    meta.shipped = date ?? todayIso();
  }
  writeText(root, specPath(id), joinFrontmatter(meta, c.body));
  return { id, from, to, meta };
}

// Change kind may change until planning is done (e.g. bugfix → minor during clarify).
// The skill asks for explicit confirmation before `major` (D-1).
export const KIND_EDITABLE = ['draft', 'clarified', 'planned'];

export function setKind(root, id, kind) {
  if (!CHANGE_KINDS.includes(kind)) fail('bad-change-kind', `Change kind must be one of ${CHANGE_KINDS.join(', ')}: ${kind}`);
  const c = loadChange(root, id);
  if (!KIND_EDITABLE.includes(c.meta.status)) {
    fail('kind-locked', `The change kind cannot change in status "${c.meta.status}".`);
  }
  const from = c.meta.change;
  writeText(root, specPath(id), joinFrontmatter({ ...c.meta, change: kind }, c.body));
  return { id, from, to: kind };
}

// A change that already left changes/ for releases/X.Y.Z-<slug>/ (after ship).
export function findShipped(root, id) {
  assertId(id);
  for (const dir of listDir(root, 'releases', { dirs: true })) {
    const path = `releases/${dir}/spec.md`;
    if (!exists(root, path)) continue;
    try {
      const { data } = splitFrontmatter(readText(root, path));
      if (data?.id === id) return { id, dir: `releases/${dir}`, meta: data };
    } catch {
      // broken specs are reported by doctor
    }
  }
  return null;
}
