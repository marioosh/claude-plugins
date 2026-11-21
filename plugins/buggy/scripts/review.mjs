#!/usr/bin/env node
// Review rounds of a change (review.md).
//
//   review.mjs round-start --type incremental|final   diff → .buggy/.tmp/review-r<N>.patch, new "## Round N";
//                                                      implemented/approved → in-review
//   review.mjs finding-add --input <json>              {source, severity, finding, location?, decision?, status?}
//   review.mjs finding-update --finding R<N>.<k> --input <json>   {decision?, status?}
//   review.mjs round-end                               checkpoint = HEAD (+ number of uncommitted files)
//   review.mjs status                                  rounds, open findings, approval gate
// All accept --id <id> (default: the change of the current branch).

import { run, parse, fail } from './lib/cli.mjs';
import { loadProject } from './lib/config.mjs';
import { consumeInput } from './lib/fsutil.mjs';
import { currentBranch } from './lib/git.mjs';
import { loadChange, setStatus, idFromBranch } from './lib/change.mjs';
import { startRound, addFinding, updateFinding, endRound, loadReview, approvalGate, reviewSummary } from './lib/review.mjs';
import { assertId } from './lib/ids.mjs';

await run(async () => {
  const { values, positionals } = parse({
    id: { type: 'string' },
    type: { type: 'string' },
    input: { type: 'string' },
    finding: { type: 'string' },
  });
  const [cmd] = positionals;
  const { root, config } = await loadProject();
  const id = assertId(values.id ?? idFromBranch(await currentBranch(root)) ?? fail('no-change', 'Not on a change branch (feature/<id>); pass --id.'));
  const change = loadChange(root, id);

  if (cmd === 'round-start') {
    const st = change.meta.status;
    if (!['implemented', 'in-review', 'approved'].includes(st)) {
      fail('bad-status', `A review needs status implemented, in-review or approved (now: ${st}).`);
    }
    const round = await startRound(root, id, { title: change.meta.title, type: values.type, mainBranch: config.mainBranch });
    if (st !== 'in-review') setStatus(root, id, 'in-review');
    return { id, ...round, status: 'in-review' };
  }
  if (cmd === 'finding-add') {
    if (!values.input) fail('bad-arguments', '--input <json> is required.');
    return { id, ...addFinding(root, id, consumeInput(root, values.input)) };
  }
  if (cmd === 'finding-update') {
    if (!values.input) fail('bad-arguments', '--input <json> is required.');
    return { id, ...updateFinding(root, id, values.finding, consumeInput(root, values.input)) };
  }
  if (cmd === 'round-end') return { id, ...(await endRound(root, id)) };
  if (cmd === 'status') {
    const text = loadReview(root, id);
    return { id, ...reviewSummary(text), approval: approvalGate(text) };
  }
  fail('bad-arguments', 'Usage: review.mjs round-start | finding-add | finding-update | round-end | status');
});
