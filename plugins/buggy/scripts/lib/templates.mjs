// Templates: the project's own `.buggy/templates/<name>` wins over the plugin's
// `templates/<name>` (design §6). Placeholders: `{{name}}`.
//
// Frontmatter is never templated: it is built from data with yaml.stringify,
// so user text can never break the YAML.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from './cli.mjs';
import { exists, readText } from './fsutil.mjs';

export const PLUGIN_TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates');
const NAME = /^[a-z][a-z-]*\.(md|yaml)$/;

export function resolveTemplate(root, name) {
  if (!NAME.test(name)) fail('bad-template', `Invalid template name: ${name}`);
  const projectRel = `.buggy/templates/${name}`;
  if (root && exists(root, projectRel)) {
    return { source: 'project', path: projectRel, text: readText(root, projectRel) };
  }
  try {
    return { source: 'plugin', path: name, text: readFileSync(join(PLUGIN_TEMPLATES, name), 'utf8') };
  } catch {
    fail('bad-template', `Unknown template: ${name}`);
  }
}

// Replaces every {{key}}; a placeholder without a value is an error.
export function render(text, vars) {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key) => {
    if (!Object.hasOwn(vars, key) || vars[key] === undefined) {
      fail('template-var-missing', `Template value missing: ${key}`);
    }
    return vars[key] === null ? '' : String(vars[key]);
  });
}

export function renderTemplate(root, name, vars) {
  const t = resolveTemplate(root, name);
  return { ...t, text: render(t.text, vars) };
}
