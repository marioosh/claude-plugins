#!/usr/bin/env node
// Changes (folders in changes/ and the status in spec.md).
//
//   change.mjs create --id <id> --input <json>     {title, change?, fromIdea?, description?} – writes changes/<id>/spec.md
//                                                  (must run on branch feature/<id>; no commit)
//   change.mjs set-kind --kind <kind> [--id <id>]  major | minor | bugfix (until status "planned")
//   change.mjs show [--id <id>]                    default: the change of the current branch
//   change.mjs list
//   change.mjs set-status --id <id> --to <status> [--input <json>]   {reason?} for "abandoned"

import { run, parse, fail } from './lib/cli.mjs';
import { loadProject } from './lib/config.mjs';
import { consumeInput } from './lib/fsutil.mjs';
import { currentBranch } from './lib/git.mjs';
import { mainVersion } from './lib/version.mjs';
import { createChange, loadChange, listChanges, setStatus, setKind, idFromBranch, branchFor } from './lib/change.mjs';
import { showIdea, titleOf } from './lib/ideas.mjs';
import { commitDocs } from './lib/consent.mjs';
import { assertId } from './lib/ids.mjs';

await run(async () => {
  const { values, positionals } = parse({
    id: { type: 'string' },
    to: { type: 'string' },
    input: { type: 'string' },
    kind: { type: 'string' },
  });
  const [cmd] = positionals;
  const { root, config } = await loadProject();
  const branch = await currentBranch(root);

  const pickId = () => {
    const id = values.id ?? idFromBranch(branch);
    if (!id) fail('no-change', 'No change id given and the current branch is not a change branch (feature/<id>).');
    return assertId(id);
  };

  if (cmd === 'create') {
    const id = assertId(values.id ?? '');
    if (branch !== branchFor(id)) fail('wrong-branch', `Switch to ${branchFor(id)} first (current: ${branch}).`);
    if (!values.input) fail('bad-arguments', '--input <json> is required.');
    const input = consumeInput(root, values.input);
    const baseVersion = await mainVersion(root, config);
    const idea = input.fromIdea ? await showIdea(root, input.fromIdea) : null;
    const c = await createChange(root, {
      id,
      title: input.title ?? (idea ? titleOf(idea.text, idea.id) : undefined),
      change: input.change ?? 'minor',
      baseVersion,
      idea,
      description: input.description ?? null,
      // Documents only, on the change branch: allowed without consent (D-10).
      commitRename: (paths) => commitDocs(root, config.mainBranch, { message: `docs: move idea ${input.fromIdea} to change ${id}`, paths }),
    });
    const out = { created: c.id, dir: c.dir, meta: c.meta };
    if (idea) {
      out.idea = { id: idea.id, moved: c.ideaMoved, branch: idea.branch };
      if (c.ideaMoved) out.renameCommitted = true;
      if (!c.ideaMoved) out.warning = `Idea ${idea.id} exists only on branch ${idea.branch}; it was copied and the file stays there.`;
    }
    return out;
  }

  if (cmd === 'show') {
    const c = loadChange(root, pickId());
    return { id: c.id, dir: c.dir, meta: c.meta, specChanged: c.specChanged, onBranch: branch === branchFor(c.id) };
  }

  if (cmd === 'list') return { changes: listChanges(root) };

  if (cmd === 'set-kind') {
    if (!values.kind) fail('bad-arguments', '--kind is required.');
    return setKind(root, pickId(), values.kind);
  }

  if (cmd === 'set-status') {
    if (!values.to) fail('bad-arguments', '--to <status> is required.');
    const input = values.input ? consumeInput(root, values.input) : {};
    return setStatus(root, pickId(), values.to, { reason: input.reason });
  }

  fail('bad-arguments', 'Usage: change.mjs create | show | list | set-status | set-kind');
});
