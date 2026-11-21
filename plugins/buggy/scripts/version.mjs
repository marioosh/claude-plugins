#!/usr/bin/env node
// Version information.
//
//   version.mjs show                 versions: working tree, main branch, latest tag
//   version.mjs next --change KIND   version a change of KIND (major|minor|bugfix) would get now

import { run, parse, fail } from './lib/cli.mjs';
import { loadProject } from './lib/config.mjs';
import { readVersion, mainVersion, nextVersion, latestTag } from './lib/version.mjs';
import { CHANGE_KINDS } from './lib/semver.mjs';

await run(async () => {
  const { values, positionals } = parse({ change: { type: 'string' } });
  const [cmd] = positionals;
  const { root, config } = await loadProject();

  if (cmd === 'show') {
    const main = await mainVersion(root, config);
    const tag = await latestTag(root);
    return {
      file: config.version.file,
      mainBranch: config.mainBranch,
      workingTree: readVersion(root, config),
      main,
      latestTag: tag,
      mainTagged: tag === `v${main}`,
    };
  }

  if (cmd === 'next') {
    if (!CHANGE_KINDS.includes(values.change)) {
      fail('bad-change-kind', `--change must be one of ${CHANGE_KINDS.join(', ')}.`);
    }
    return { change: values.change, ...(await nextVersion(root, config, values.change)) };
  }

  fail('bad-arguments', 'Usage: version.mjs show | next --change <major|minor|bugfix>');
});
