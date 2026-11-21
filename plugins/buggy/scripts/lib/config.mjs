// `.buggy/config.yaml`: loading, validation and defaults (design §3.1, D-19, D-27).

import { fail } from './cli.mjs';
import { exists, readText } from './fsutil.mjs';
import { parse } from './yaml.mjs';
import { repoRoot } from './git.mjs';

export const CONFIG_PATH = '.buggy/config.yaml';
export const FORMAT = 1;

const LANG = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

function str(v, name, def) {
  if (v === undefined || v === null) return def;
  if (typeof v !== 'string' || v.trim() === '') fail('bad-config', `${name} must be a non-empty string.`);
  return v;
}

export function normalize(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail('bad-config', 'Config must be a map.');
  if (raw.buggy !== FORMAT) fail('bad-config', `Unsupported config format "buggy: ${raw.buggy}" (expected ${FORMAT}).`);

  const mainBranch = str(raw.main_branch, 'main_branch', 'main');

  const v = raw.version ?? {};
  if (typeof v !== 'object' || Array.isArray(v)) fail('bad-config', 'version must be a map.');
  const file = str(v.file, 'version.file', 'version.txt');
  if (file.startsWith('/') || file.split('/').includes('..')) fail('bad-config', 'version.file must be a path inside the repository.');
  const isJson = file.endsWith('.json');
  const key = isJson ? str(v.key, 'version.key', 'version') : null;
  if (key !== null && !/^[A-Za-z0-9_-]+$/.test(key)) fail('bad-config', 'version.key must be a top-level JSON key.');

  const l = raw.language ?? {};
  if (typeof l !== 'object' || Array.isArray(l)) fail('bad-config', 'language must be a map.');
  const language = {
    docs: str(l.docs, 'language.docs', 'en'),
    code: str(l.code, 'language.code', 'en'),
    commits: str(l.commits, 'language.commits', 'en'),
    exceptions: l.exceptions ?? [],
  };
  for (const k of ['docs', 'code', 'commits']) {
    if (!LANG.test(language[k])) fail('bad-config', `language.${k} must be a language code such as "en" or "pl".`);
  }
  if (!Array.isArray(language.exceptions) || language.exceptions.some((e) => typeof e !== 'string')) {
    fail('bad-config', 'language.exceptions must be a list of strings.');
  }

  return {
    buggy: FORMAT,
    mainBranch,
    version: { file, format: isJson ? 'json' : 'text', key },
    language,
  };
}

// Config of the project at `root`, or null when buggy is not set up there.
export function loadConfig(root) {
  if (!exists(root, CONFIG_PATH)) return null;
  return normalize(parse(readText(root, CONFIG_PATH, { maxBytes: 64 * 1024 })));
}

// Repository root + config; errors when not in a git repo or buggy is not set up.
export async function loadProject(cwd = process.cwd()) {
  const root = await repoRoot(cwd);
  if (!root) fail('not-git', 'This folder is not inside a git repository.');
  const config = loadConfig(root);
  if (!config) fail('not-buggy', 'buggy is not set up in this repository (no .buggy/config.yaml). Run /buggy:start.');
  return { root, config };
}
