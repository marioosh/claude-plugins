// Ideas: one file per idea, `ideas/<YYYYMMDD-slug>.md` (D-6). An idea may live
// on any local branch until that branch is merged, so listing looks at the
// working tree and at every local branch.

import { fail } from './cli.mjs';
import { exists, readText, writeText, listDir } from './fsutil.mjs';
import { git, show, localBranches } from './git.mjs';
import { renderTemplate } from './templates.mjs';
import { today, todayIso, slugify, makeId, assertId, isValidId } from './ids.mjs';
import { splitFrontmatter } from './yaml.mjs';

export const IDEAS_DIR = 'ideas';
export const ideaPath = (id) => `${IDEAS_DIR}/${assertId(id)}.md`;

const idFromFile = (name) => (name.endsWith('.md') && isValidId(name.slice(0, -3)) ? name.slice(0, -3) : null);

// Title = first Markdown H1 line, falling back to the id.
export function titleOf(text, id) {
  const m = text.match(/^#[ \t]+(.+?)[ \t]*$/m);
  return m ? m[1] : id;
}

async function idsOnBranch(root, branch) {
  const out = await git(['ls-tree', '--name-only', `${branch}`, '--', `${IDEAS_DIR}/`], { cwd: root, allowFail: true });
  if (!out) return [];
  return out
    .split('\n')
    .map((p) => idFromFile(p.slice(IDEAS_DIR.length + 1)))
    .filter(Boolean);
}

// Ideas already turned into a change: `from_idea` in the spec of every change
// on a `feature/<id>` branch → { ideaId: changeId }.
async function startedIdeas(root) {
  const started = {};
  for (const branch of await localBranches(root)) {
    const m = branch.match(/^feature\/(\d{8}-[a-z0-9-]+)$/);
    if (!m || !isValidId(m[1])) continue;
    const text = await show(root, branch, `changes/${m[1]}/spec.md`);
    if (!text) continue;
    try {
      const from = splitFrontmatter(text).data?.from_idea;
      if (from) started[from] = m[1];
    } catch {
      // a broken spec is reported elsewhere (state, doctor)
    }
  }
  return started;
}

// [{ id, title, inWorkingTree, branches: [...], startedAs? }] sorted by id.
export async function listIdeas(root) {
  const ideas = new Map();
  const get = (id) => {
    if (!ideas.has(id)) ideas.set(id, { id, title: null, inWorkingTree: false, branches: [] });
    return ideas.get(id);
  };
  for (const name of listDir(root, IDEAS_DIR, { files: true })) {
    const id = idFromFile(name);
    if (!id) continue;
    const idea = get(id);
    idea.inWorkingTree = true;
    idea.title = titleOf(readText(root, ideaPath(id)), id);
  }
  for (const branch of await localBranches(root)) {
    for (const id of await idsOnBranch(root, branch)) {
      const idea = get(id);
      idea.branches.push(branch);
      if (idea.title === null) idea.title = titleOf((await show(root, branch, ideaPath(id))) ?? '', id);
    }
  }
  const started = await startedIdeas(root);
  for (const idea of ideas.values()) if (started[idea.id]) idea.startedAs = started[idea.id];
  return [...ideas.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// Text of an idea: from the working tree, or from the first branch that has it.
export async function showIdea(root, id) {
  assertId(id);
  if (exists(root, ideaPath(id))) {
    return { id, text: readText(root, ideaPath(id)), inWorkingTree: true, branch: null };
  }
  for (const branch of await localBranches(root)) {
    const text = await show(root, branch, ideaPath(id));
    if (text !== null) return { id, text: `${text}\n`, inWorkingTree: false, branch };
  }
  fail('idea-not-found', `Idea not found: ${id}`);
}

export async function createIdea(root, { title, description = '' }, date = today()) {
  if (typeof title !== 'string' || title.trim() === '') fail('bad-input', 'title is required.');
  if (typeof description !== 'string') fail('bad-input', 'description must be text.');
  const known = (await listIdeas(root)).map((i) => i.id);
  const id = makeId(date, slugify(title), known);
  const text = renderTemplate(root, 'idea.md', {
    title: title.trim(),
    date: todayIso(new Date(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)))),
    description: description.trim(),
  }).text;
  writeText(root, ideaPath(id), text, { exclusive: true });
  return { id, path: ideaPath(id), title: title.trim() };
}
