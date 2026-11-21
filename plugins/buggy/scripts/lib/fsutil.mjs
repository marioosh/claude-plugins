// Hardening (design §7.3, D-25): every file read and write of buggy scripts
// goes through this module.
//
// Rules:
// - Paths are relative to the repository root and must stay inside it
//   (no absolute paths, no `..` escapes, checked again after resolving symlinks
//   of parent directories).
// - Symlinks are refused for the file itself, both for reading and writing:
//   a symlink in a repository could point at ~/.ssh/… or ~/.zshrc.
// - Reads are size-limited.
// - Writes are atomic (temporary file in the same directory + rename) and keep
//   the mode of an existing file.

import {
  lstatSync,
  realpathSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  chmodSync,
  rmSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { isAbsolute, join, normalize, dirname, basename, sep, relative } from 'node:path';
import { fail } from './cli.mjs';

export const DEFAULT_MAX_BYTES = 1024 * 1024; // 1 MiB

function within(base, target) {
  const rel = relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

// Nearest existing ancestor of `p` (inclusive).
function existingAncestor(p) {
  let cur = p;
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) return cur;
    cur = parent;
  }
  return cur;
}

// Resolve `rel` against `root`; refuse anything that ends up outside the root.
export function resolveInside(root, rel) {
  if (typeof rel !== 'string' || rel === '') fail('bad-path', 'Empty path.');
  if (isAbsolute(rel)) fail('path-outside-repo', `Absolute paths are not allowed: ${rel}`);
  if (rel.includes('\0')) fail('bad-path', 'Path contains a NUL character.');
  const realRoot = realpathSync(root);
  const target = normalize(join(realRoot, rel));
  if (!within(realRoot, target)) fail('path-outside-repo', `Path leaves the repository: ${rel}`);
  if (target === realRoot) return target;
  // Parent directories may be symlinks to somewhere else – check the real location.
  const anchor = existingAncestor(dirname(target));
  if (!within(realRoot, realpathSync(anchor))) {
    fail('path-outside-repo', `Path resolves outside the repository: ${rel}`);
  }
  return target;
}

function refuseSymlink(abs, rel) {
  let st;
  try {
    st = lstatSync(abs);
  } catch {
    return null; // does not exist
  }
  if (st.isSymbolicLink()) fail('symlink-refused', `Refusing to use a symlink: ${rel}`);
  return st;
}

export function exists(root, rel) {
  return existsSync(resolveInside(root, rel));
}

export function readText(root, rel, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const abs = resolveInside(root, rel);
  const st = refuseSymlink(abs, rel);
  if (!st) fail('not-found', `File not found: ${rel}`);
  if (!st.isFile()) fail('not-a-file', `Not a regular file: ${rel}`);
  if (st.size > maxBytes) fail('file-too-large', `File is larger than ${maxBytes} bytes: ${rel}`);
  return readFileSync(abs, 'utf8');
}

// Create a directory (and parents) inside the repository.
export function ensureDir(root, rel) {
  const abs = resolveInside(root, rel);
  const st = refuseSymlink(abs, rel);
  if (st && !st.isDirectory()) fail('not-a-directory', `Not a directory: ${rel}`);
  mkdirSync(abs, { recursive: true });
  // mkdir may have created directories through a parent that is a symlink – re-check.
  resolveInside(root, rel);
  return abs;
}

export function writeText(root, rel, text, { exclusive = false } = {}) {
  const abs = resolveInside(root, rel);
  const st = refuseSymlink(abs, rel);
  if (st && !st.isFile()) fail('not-a-file', `Not a regular file: ${rel}`);
  if (st && exclusive) fail('already-exists', `File already exists: ${rel}`);
  ensureDir(root, relative(realpathSync(root), dirname(abs)) || '.');
  const tmp = join(dirname(abs), `.${basename(abs)}.buggy-tmp-${process.pid}`);
  try {
    writeFileSync(tmp, text, { flag: 'wx' });
    if (st) chmodSync(tmp, st.mode & 0o7777);
    renameSync(tmp, abs);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  return abs;
}

// JSON input written by the model with the file tool (D-25: text never goes
// through shell arguments). `path` may be absolute: it is the model's own file,
// not a repository path, but it still must be a small regular file, not a symlink.
export function readJsonInput(path, { maxBytes = 256 * 1024 } = {}) {
  let st;
  try {
    st = lstatSync(path);
  } catch {
    fail('not-found', `Input file not found: ${path}`);
  }
  if (st.isSymbolicLink()) fail('symlink-refused', `Refusing to read a symlink: ${path}`);
  if (!st.isFile()) fail('not-a-file', `Input is not a regular file: ${path}`);
  if (st.size > maxBytes) fail('file-too-large', `Input file is larger than ${maxBytes} bytes.`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    fail('bad-input', `Input is not valid JSON: ${err.message}`);
  }
}

// Model input files live in `.buggy/.tmp/` (D-40): written with the Write tool
// (allowed by `Edit(/.buggy/.tmp/**)`), read once by a script, then deleted.
export const INPUT_DIR = '.buggy/.tmp';
const BUGGY_GITIGNORE = '.buggy/.gitignore';

// Makes sure `.buggy/.tmp/` is ignored by git (idempotent). Used by setup (start).
export function ensureInputDirIgnored(root) {
  if (!existsSync(join(realpathSync(root), '.buggy'))) return false;
  const current = exists(root, BUGGY_GITIGNORE) ? readText(root, BUGGY_GITIGNORE) : '';
  if (current.split(/\r?\n/).some((l) => l.trim() === '.tmp/' || l.trim() === '.tmp')) return false;
  const sep = current === '' || current.endsWith('\n') ? '' : '\n';
  writeText(root, BUGGY_GITIGNORE, `${current}${sep}.tmp/\n`);
  return true;
}

// Reads a JSON input file; deletes it afterwards when it lives in `.buggy/.tmp/`.
// `path` is relative to the current directory (as the model wrote it) or absolute.
export function consumeInput(root, path, opts) {
  const data = readJsonInput(path, opts);
  const realRoot = realpathSync(root);
  const tmpDir = join(realRoot, INPUT_DIR);
  let real;
  try {
    real = realpathSync(path);
  } catch {
    real = null;
  }
  if (real && within(tmpDir, real) && real !== tmpDir) rmSync(real, { force: true });
  return data;
}

// Names of entries in a repository directory (symlinks skipped); [] when missing.
export function listDir(root, rel, { dirs = false, files = false } = {}) {
  const abs = resolveInside(root, rel);
  const st = refuseSymlink(abs, rel);
  if (!st) return [];
  if (!st.isDirectory()) fail('not-a-directory', `Not a directory: ${rel}`);
  return readdirSync(abs, { withFileTypes: true })
    .filter((e) => !e.isSymbolicLink() && ((dirs && e.isDirectory()) || (files && e.isFile())))
    .map((e) => e.name)
    .sort();
}

export const _test = { within, sep };
