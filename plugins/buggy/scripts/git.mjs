#!/usr/bin/env node
// Git operations of buggy. Text from the model (titles, commit messages) always
// comes from a JSON file (--input), never from command-line arguments.
//
//   git.mjs branch-new --input <json> [--mode abort|stash|carry]
//                                                    {title}            → feature/<id> from the main branch
//   git.mjs branch-chore --input <json>              {title}            → chore/<date>-<slug> from the main branch,
//                                                                       uncommitted changes come along (D-29, P2 of stage 2)
//   git.mjs commit-docs --input <json>               {message, paths?}  → buggy documents only, no consent needed
//   git.mjs commit-plan --input <json>               {message, paths}   → preview + token, nothing committed
//   git.mjs commit-do --token <t> --input <json>     {message, paths}   → commit if the token still matches

import { run, parse, fail } from './lib/cli.mjs';
import { loadProject } from './lib/config.mjs';
import { consumeInput } from './lib/fsutil.mjs';
import { status, switchCreate, currentBranch, localBranches, git } from './lib/git.mjs';
import { newChangeId, branchFor } from './lib/change.mjs';
import { today, slugify, makeId } from './lib/ids.mjs';
import { planCommit, doCommit, commitDocs } from './lib/consent.mjs';

await run(async () => {
  const { values, positionals } = parse({
    input: { type: 'string' },
    token: { type: 'string' },
    mode: { type: 'string' },
  });
  const [cmd] = positionals;
  if (!['branch-new', 'branch-chore', 'commit-docs', 'commit-plan', 'commit-do'].includes(cmd)) {
    fail('bad-arguments', 'Usage: git.mjs branch-new | branch-chore | commit-docs | commit-plan | commit-do');
  }
  if (!values.input) fail('bad-arguments', '--input <json> is required.');
  const { root, config } = await loadProject();
  const input = consumeInput(root, values.input);
  const main = config.mainBranch;

  if (cmd === 'branch-new') {
    const mode = values.mode ?? 'abort';
    if (!['abort', 'stash', 'carry'].includes(mode)) fail('bad-arguments', '--mode must be abort, stash or carry.');
    const id = await newChangeId(root, input.title);
    const branch = branchFor(id);
    const from = await currentBranch(root);
    const dirty = (await status(root)).map((e) => e.path);
    const result = { id, branch, base: main, from, mode: dirty.length ? mode : 'clean' };

    if (dirty.length && mode === 'abort') {
      fail('dirty-tree', 'There are uncommitted changes. Ask the user: abort, stash, or carry them to the new branch.', {
        files: dirty,
      });
    }
    if (dirty.length && mode === 'stash') {
      await git(['stash', 'push', '--include-untracked', '--quiet', '-m', `buggy: before ${id} (from ${from ?? 'detached HEAD'})`], { cwd: root });
      result.stashed = dirty;
      result.restore = from ? `git switch ${from} && git stash pop` : 'git stash pop';
    }
    if (dirty.length && mode === 'carry') {
      try {
        await switchCreate(root, branch, main);
      } catch (err) {
        fail('carry-conflict', `The uncommitted changes conflict with ${main}; nothing was changed. Choose stash or commit them first.`, {
          files: dirty,
          git: err.message,
        });
      }
      result.carried = dirty;
      return result;
    }
    await switchCreate(root, branch, main);
    return result;
  }

  if (cmd === 'branch-chore') {
    const existing = (await localBranches(root)).filter((b) => b.startsWith('chore/')).map((b) => b.slice(6));
    const id = makeId(today(), slugify(input.title), existing);
    const branch = `chore/${id}`;
    try {
      await switchCreate(root, branch, main);
    } catch (err) {
      if (err.code !== 'git-failed') throw err;
      fail('carry-conflict', `Uncommitted changes conflict with ${main}; nothing was changed.`, { git: err.message });
    }
    return { branch, base: main };
  }

  if (cmd === 'commit-docs') return commitDocs(root, main, input);
  if (cmd === 'commit-plan') return planCommit(root, main, input);

  if (!values.token) fail('bad-arguments', '--token is required.');
  return doCommit(root, main, { ...input, token: values.token });
});
