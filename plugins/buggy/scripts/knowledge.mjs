#!/usr/bin/env node
// Project knowledge files in .buggy/ (principle 5: the plugin knows no technology,
// the project does).
//
//   knowledge.mjs init --name <name>   .buggy/<name>.md from the template (only if missing);
//                                      names: build-test, project, requirements, architecture, stack, ui, adoption-plan, release

import { run, parse, fail } from './lib/cli.mjs';
import { loadProject } from './lib/config.mjs';
import { exists, writeText } from './lib/fsutil.mjs';
import { renderTemplate } from './lib/templates.mjs';

const KNOWN = ['build-test', 'project', 'requirements', 'architecture', 'stack', 'ui', 'adoption-plan', 'release'];

await run(async () => {
  const { values, positionals } = parse({ name: { type: 'string' } });
  const [cmd] = positionals;
  if (cmd === 'init') {
    if (!KNOWN.includes(values.name)) fail('bad-arguments', `--name must be one of: ${KNOWN.join(', ')}`);
    const { root } = await loadProject();
    const path = `.buggy/${values.name}.md`;
    if (exists(root, path)) return { created: false, path };
    writeText(root, path, renderTemplate(root, `${values.name}.md`, {}).text, { exclusive: true });
    return { created: true, path };
  }
  fail('bad-arguments', 'Usage: knowledge.mjs init --name <name>');
});
