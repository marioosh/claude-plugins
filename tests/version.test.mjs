import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, gitIn, writeFile, runScript } from './helpers.mjs';
import { normalize, loadConfig } from '../plugins/buggy/scripts/lib/config.mjs';
import { readVersion, writeVersion } from '../plugins/buggy/scripts/lib/version.mjs';

function code(fn) {
  try {
    fn();
  } catch (e) {
    return e.code;
  }
  return 'no-error';
}

function buggyRepo(t, { config = 'buggy: 1\n', files = {} } = {}) {
  const dir = tempRepo(t);
  writeFile(dir, '.buggy/config.yaml', config);
  for (const [p, c] of Object.entries(files)) writeFile(dir, p, c);
  gitIn(dir, ['add', '.']);
  gitIn(dir, ['commit', '-q', '-m', 'setup']);
  return dir;
}

// ---------- config ----------

test('config defaults', () => {
  assert.deepEqual(normalize({ buggy: 1 }), {
    buggy: 1,
    mainBranch: 'main',
    version: { file: 'version.txt', format: 'text', key: null },
    language: { docs: 'en', code: 'en', commits: 'en', exceptions: [] },
  });
});

test('config: JSON version file, language, exceptions', () => {
  const c = normalize({
    buggy: 1,
    main_branch: 'master',
    version: { file: 'package.json' },
    language: { docs: 'pl', exceptions: ['.buggy/ui.md: pl'] },
  });
  assert.equal(c.mainBranch, 'master');
  assert.deepEqual(c.version, { file: 'package.json', format: 'json', key: 'version' });
  assert.equal(c.language.docs, 'pl');
});

test('config: invalid values are errors', () => {
  for (const raw of [
    { buggy: 2 },
    {},
    { buggy: 1, version: { file: '../x.txt' } },
    { buggy: 1, version: { file: '/etc/v' } },
    { buggy: 1, language: { docs: 'polish' } },
    { buggy: 1, language: { exceptions: 'x' } },
    { buggy: 1, main_branch: '' },
  ]) {
    assert.equal(code(() => normalize(raw)), 'bad-config', JSON.stringify(raw));
  }
});

test('loadConfig: null without .buggy, parsed with it', (t) => {
  const dir = tempRepo(t);
  assert.equal(loadConfig(dir), null);
  writeFile(dir, '.buggy/config.yaml', 'buggy: 1\nlanguage:\n  docs: pl\n');
  assert.equal(loadConfig(dir).language.docs, 'pl');
});

// ---------- version file ----------

test('text version file: read and write', (t) => {
  const dir = buggyRepo(t, { files: { 'version.txt': '0.6.4\n' } });
  const cfg = loadConfig(dir);
  assert.equal(readVersion(dir, cfg), '0.6.4');
  writeVersion(dir, cfg, '0.7.0');
  assert.equal(readFileSync(join(dir, 'version.txt'), 'utf8'), '0.7.0\n');
});

test('JSON version file: only the version value changes', (t) => {
  const pkg = '{\n    "name": "app",\n    "version": "1.2.3",\n    "deps": { "x": "1.2.3" }\n}\n';
  const dir = buggyRepo(t, {
    config: 'buggy: 1\nversion:\n  file: package.json\n',
    files: { 'package.json': pkg },
  });
  const cfg = loadConfig(dir);
  assert.equal(readVersion(dir, cfg), '1.2.3');
  writeVersion(dir, cfg, '1.3.0');
  assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), pkg.replace('"version": "1.2.3"', '"version": "1.3.0"'));
});

test('invalid version content is an error', (t) => {
  const dir = buggyRepo(t, { files: { 'version.txt': 'one\n' } });
  assert.equal(code(() => readVersion(dir, loadConfig(dir))), 'bad-version');
});

// ---------- version.mjs ----------

test('version show: main version, working tree, tags', (t) => {
  const dir = buggyRepo(t, { files: { 'version.txt': '0.6.4\n' } });
  gitIn(dir, ['tag', 'v0.6.4']);
  gitIn(dir, ['switch', '-q', '-c', 'feature/20261119-x']);
  writeFile(dir, 'version.txt', '0.7.0\n');
  const r = runScript('version', ['show'], { cwd: dir });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.main, '0.6.4');
  assert.equal(r.json.workingTree, '0.7.0');
  assert.equal(r.json.latestTag, 'v0.6.4');
  assert.equal(r.json.mainTagged, true);
});

test('version next: from main; 0.0.0 when no version file on main', (t) => {
  const dir = buggyRepo(t, { files: { 'version.txt': '0.6.4\n' } });
  assert.deepEqual(runScript('version', ['next', '--change', 'minor'], { cwd: dir }).json, {
    status: 'ok',
    change: 'minor',
    main: '0.6.4',
    next: '0.7.0',
  });
  const fresh = buggyRepo(t);
  assert.equal(runScript('version', ['next', '--change', 'minor'], { cwd: fresh }).json.next, '0.1.0');
});

test('version: errors are JSON with exit 1', (t) => {
  const dir = buggyRepo(t);
  let r = runScript('version', ['next', '--change', 'patch'], { cwd: dir });
  assert.equal(r.code, 1);
  assert.equal(r.json.code, 'bad-change-kind');
  r = runScript('version', ['show', '--bogus'], { cwd: dir });
  assert.equal(r.json.code, 'bad-arguments');
  r = runScript('version', ['show'], { cwd: tempRepo(t) });
  assert.equal(r.json.code, 'not-buggy');
});
