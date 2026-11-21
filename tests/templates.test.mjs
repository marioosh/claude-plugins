import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, writeFile } from './helpers.mjs';
import { resolveTemplate, render, renderTemplate, PLUGIN_TEMPLATES } from '../plugins/buggy/scripts/lib/templates.mjs';
import { parse } from '../plugins/buggy/scripts/lib/yaml.mjs';
import { normalize } from '../plugins/buggy/scripts/lib/config.mjs';

function code(fn) {
  try {
    fn();
  } catch (e) {
    return e.code;
  }
  return 'no-error';
}

test('all plugin templates exist', () => {
  assert.deepEqual(readdirSync(PLUGIN_TEMPLATES).sort(), [
    'adoption-plan.md',
    'architecture.md',
    'build-test.md',
    'claude-block.md',
    'config.yaml',
    'history.md',
    'idea.md',
    'plan.md',
    'project.md',
    'release-note.md',
    'release.md',
    'requirements.md',
    'review.md',
    'spec.md',
    'stack.md',
    'ui.md',
  ]);
});

test('config.yaml template parses and is a valid config', () => {
  const cfg = normalize(parse(readFileSync(join(PLUGIN_TEMPLATES, 'config.yaml'), 'utf8')));
  assert.equal(cfg.mainBranch, 'main');
  assert.equal(cfg.version.file, 'version.txt');
});

test('plan.md template keeps the step format checked by implement', () => {
  assert.match(readFileSync(join(PLUGIN_TEMPLATES, 'plan.md'), 'utf8'), /^- \[ \] S1\./m);
});

test('project template overrides the plugin template', (t) => {
  const dir = tempRepo(t);
  assert.equal(resolveTemplate(dir, 'spec.md').source, 'plugin');
  writeFile(dir, '.buggy/templates/spec.md', '# Custom {{title}}\n');
  const r = renderTemplate(dir, 'spec.md', { title: 'X' });
  assert.equal(r.source, 'project');
  assert.equal(r.text, '# Custom X\n');
});

test('render: values, null, missing value, user text is not re-interpreted', () => {
  assert.equal(render('{{a}}-{{ b }}', { a: 1, b: null }), '1-');
  assert.equal(code(() => render('{{a}}', {})), 'template-var-missing');
  assert.equal(render('{{a}}', { a: '{{b}} $(x)' }), '{{b}} $(x)');
});

test('invalid template names are refused', () => {
  for (const name of ['../config.yaml', 'spec', 'Spec.md', 'a/b.md', 'nope.md']) {
    assert.equal(code(() => resolveTemplate(null, name)), 'bad-template', name);
  }
});
