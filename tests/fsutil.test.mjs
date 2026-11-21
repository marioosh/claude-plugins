import { test } from 'node:test';
import assert from 'node:assert/strict';
import { symlinkSync, readFileSync, statSync, chmodSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir, writeFile } from './helpers.mjs';
import {
  resolveInside,
  readText,
  writeText,
  ensureDir,
  readJsonInput,
  consumeInput,
  ensureInputDirIgnored,
} from '../plugins/buggy/scripts/lib/fsutil.mjs';

function code(fn) {
  try {
    fn();
  } catch (e) {
    return e.code;
  }
  return 'no-error';
}

test('resolveInside accepts paths inside the root', (t) => {
  const root = tempDir(t);
  assert.ok(resolveInside(root, 'changes/x/spec.md').endsWith(join('changes', 'x', 'spec.md')));
  assert.ok(resolveInside(root, 'a/../b.md').endsWith('b.md'));
});

test('resolveInside refuses absolute paths and escapes', (t) => {
  const root = tempDir(t);
  assert.equal(code(() => resolveInside(root, '/etc/passwd')), 'path-outside-repo');
  assert.equal(code(() => resolveInside(root, '../outside.md')), 'path-outside-repo');
  assert.equal(code(() => resolveInside(root, 'a/../../outside.md')), 'path-outside-repo');
  assert.equal(code(() => resolveInside(root, '')), 'bad-path');
});

test('a parent directory that is a symlink to outside is refused', (t) => {
  const root = tempDir(t);
  const outside = tempDir(t);
  symlinkSync(outside, join(root, 'changes'));
  assert.equal(code(() => resolveInside(root, 'changes/x/spec.md')), 'path-outside-repo');
  assert.equal(code(() => writeText(root, 'changes/spec.md', 'x')), 'path-outside-repo');
});

test('writing through a symlinked file is refused and the target is untouched', (t) => {
  const root = tempDir(t);
  const outside = tempDir(t);
  const victim = join(outside, 'zshrc');
  writeFileSync(victim, 'original\n');
  mkdirSync(join(root, 'changes'));
  symlinkSync(victim, join(root, 'changes', 'spec.md'));
  assert.equal(code(() => writeText(root, 'changes/spec.md', 'pwned')), 'symlink-refused');
  assert.equal(readFileSync(victim, 'utf8'), 'original\n');
});

test('reading a symlinked file is refused', (t) => {
  const root = tempDir(t);
  const outside = tempDir(t);
  writeFileSync(join(outside, 'secret'), 'key');
  symlinkSync(join(outside, 'secret'), join(root, 'spec.md'));
  assert.equal(code(() => readText(root, 'spec.md')), 'symlink-refused');
});

test('read size limit', (t) => {
  const root = tempDir(t);
  writeFile(root, 'big.md', 'x'.repeat(2000));
  assert.equal(code(() => readText(root, 'big.md', { maxBytes: 1000 })), 'file-too-large');
  assert.equal(readText(root, 'big.md', { maxBytes: 5000 }).length, 2000);
});

test('readText reports missing files and directories', (t) => {
  const root = tempDir(t);
  ensureDir(root, 'dir');
  assert.equal(code(() => readText(root, 'nope.md')), 'not-found');
  assert.equal(code(() => readText(root, 'dir')), 'not-a-file');
});

test('writeText creates parents, writes atomically, keeps file mode', (t) => {
  const root = tempDir(t);
  writeText(root, 'a/b/c.md', 'one\n');
  assert.equal(readText(root, 'a/b/c.md'), 'one\n');
  chmodSync(join(root, 'a/b/c.md'), 0o600);
  writeText(root, 'a/b/c.md', 'two\n');
  assert.equal(readText(root, 'a/b/c.md'), 'two\n');
  assert.equal(statSync(join(root, 'a/b/c.md')).mode & 0o777, 0o600);
});

test('writeText exclusive refuses to overwrite', (t) => {
  const root = tempDir(t);
  writeText(root, 'x.md', '1');
  assert.equal(code(() => writeText(root, 'x.md', '2', { exclusive: true })), 'already-exists');
});

test('readJsonInput: valid, invalid, symlink, too large', (t) => {
  const dir = tempDir(t);
  const ok = join(dir, 'ok.json');
  writeFileSync(ok, '{"message":"feat: x"}');
  assert.deepEqual(readJsonInput(ok), { message: 'feat: x' });
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, '{nope');
  assert.equal(code(() => readJsonInput(bad)), 'bad-input');
  symlinkSync(ok, join(dir, 'link.json'));
  assert.equal(code(() => readJsonInput(join(dir, 'link.json'))), 'symlink-refused');
  assert.equal(code(() => readJsonInput(ok, { maxBytes: 5 })), 'file-too-large');
  assert.equal(code(() => readJsonInput(join(dir, 'missing.json'))), 'not-found');
});

// ---------- input files (D-40) ----------


test('consumeInput deletes input files from .buggy/.tmp/ only', (t) => {
  const root = tempDir(t);
  const inTmp = writeFile(root, '.buggy/.tmp/new-ab12.json', '{"title":"x"}');
  assert.deepEqual(consumeInput(root, inTmp), { title: 'x' });
  assert.equal(existsSync(inTmp), false);
  const elsewhere = writeFile(root, 'keep.json', '{"a":1}');
  assert.deepEqual(consumeInput(root, elsewhere), { a: 1 });
  assert.equal(existsSync(elsewhere), true);
});

test('ensureInputDirIgnored is idempotent and keeps existing lines', (t) => {
  const root = tempDir(t);
  writeFile(root, '.buggy/.gitignore', 'local.yaml');
  assert.equal(ensureInputDirIgnored(root), true);
  assert.equal(ensureInputDirIgnored(root), false);
  assert.equal(readFileSync(join(root, '.buggy/.gitignore'), 'utf8'), 'local.yaml\n.tmp/\n');
});
