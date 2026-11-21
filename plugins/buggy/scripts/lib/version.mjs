// The project's version file: plain text (version.txt) or a top-level key of a
// JSON file (package.json → "version") – D-27.

import { fail } from './cli.mjs';
import { exists, readText, writeText } from './fsutil.mjs';
import { show, versionTags } from './git.mjs';
import { isValid, bump } from './semver.mjs';

function extract(text, vcfg, where) {
  let v;
  if (vcfg.format === 'json') {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      fail('bad-version-file', `${vcfg.file} is not valid JSON (${where}).`);
    }
    v = data?.[vcfg.key];
  } else {
    v = text.trim();
  }
  if (!isValid(v)) fail('bad-version', `${vcfg.file} does not hold a version X.Y.Z (${where}): ${JSON.stringify(v)}`);
  return v;
}

// Version in the working tree, or null when the file does not exist.
export function readVersion(root, config) {
  const vcfg = config.version;
  if (!exists(root, vcfg.file)) return null;
  return extract(readText(root, vcfg.file), vcfg, 'working tree');
}

// Version at a git ref (e.g. the main branch), or null when the file is not there.
export async function readVersionAt(root, config, ref) {
  const text = await show(root, ref, config.version.file);
  if (text === null) return null;
  return extract(text, config.version, ref);
}

// Writes `v`, changing nothing else in the file (JSON formatting is preserved).
export function writeVersion(root, config, v) {
  if (!isValid(v)) fail('bad-version', `Not a version (X.Y.Z): ${v}`);
  const vcfg = config.version;
  if (vcfg.format === 'text') {
    writeText(root, vcfg.file, `${v}\n`);
    return;
  }
  const text = readText(root, vcfg.file);
  const current = extract(text, vcfg, 'working tree');
  const key = vcfg.key.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  const re = new RegExp(`("${key}"\\s*:\\s*")${current.replace(/\./g, '\\.')}(")`);
  const updated = text.replace(re, `$1${v}$2`);
  if (updated === text || JSON.parse(updated)[vcfg.key] !== v) {
    fail('version-write-failed', `Could not update "${vcfg.key}" in ${vcfg.file} safely.`);
  }
  writeText(root, vcfg.file, updated);
}

// Version on the main branch (0.0.0 when nothing was released yet) and the
// version a change of the given kind would get if shipped now.
export async function mainVersion(root, config) {
  return (await readVersionAt(root, config, config.mainBranch)) ?? '0.0.0';
}

export async function nextVersion(root, config, kind) {
  const main = await mainVersion(root, config);
  return { main, next: bump(main, kind) };
}

export async function latestTag(root) {
  return (await versionTags(root))[0] ?? null;
}
