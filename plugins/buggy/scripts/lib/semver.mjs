// Semantic versions X.Y.Z (no pre-release or build metadata in v1).

import { fail } from './cli.mjs';

export const CHANGE_KINDS = ['major', 'minor', 'bugfix'];
const RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isValid(v) {
  return typeof v === 'string' && RE.test(v);
}

export function parse(v) {
  const m = typeof v === 'string' && v.trim().match(RE);
  if (!m) fail('bad-version', `Not a version (X.Y.Z): ${v}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function format({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

export function bump(v, kind) {
  const p = parse(v);
  if (kind === 'major') return format({ major: p.major + 1, minor: 0, patch: 0 });
  if (kind === 'minor') return format({ major: p.major, minor: p.minor + 1, patch: 0 });
  if (kind === 'bugfix') return format({ major: p.major, minor: p.minor, patch: p.patch + 1 });
  fail('bad-change-kind', `Change kind must be one of ${CHANGE_KINDS.join(', ')}: ${kind}`);
}

export function compare(a, b) {
  const x = parse(a);
  const y = parse(b);
  return x.major - y.major || x.minor - y.minor || x.patch - y.patch;
}
