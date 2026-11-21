// Change and idea identifiers: `YYYYMMDD-slug` (D-2, D-38 P5–P7).

import { fail } from './cli.mjs';

export const ID_RE = /^\d{8}-[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MAX = 40;

// Characters that NFD does not decompose into base letter + accent.
const SPECIAL = { ł: 'l', Ł: 'l', ß: 'ss', æ: 'ae', Æ: 'ae', ø: 'o', Ø: 'o', đ: 'd', Đ: 'd', œ: 'oe', Œ: 'oe' };

// Local date of the user's machine as YYYYMMDD.
export function today(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// Local date of the user's machine as YYYY-MM-DD.
export function todayIso(date = new Date()) {
  const d = today(date);
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

export function slugify(text) {
  if (typeof text !== 'string') fail('bad-slug', 'Description must be text.');
  const ascii = [...text]
    .map((c) => SPECIAL[c] ?? c)
    .join('')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  let slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length > SLUG_MAX) {
    // Cut at a word boundary when possible ("…w-stylu", not "…w-stylu-githu").
    const cut = slug.slice(0, SLUG_MAX + 1);
    const at = cut.lastIndexOf('-');
    slug = (at > SLUG_MAX / 2 ? cut.slice(0, at) : slug.slice(0, SLUG_MAX)).replace(/-+$/, '');
  }
  if (slug === '') fail('bad-slug', `Cannot build a name from: "${text}"`);
  return slug;
}

export function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

// `existing`: ids already used (changes, ideas, branches). Same day + same slug → -2, -3…
export function makeId(date, slug, existing = []) {
  if (!/^\d{8}$/.test(date)) fail('bad-id', `Invalid date: ${date}`);
  const taken = new Set(existing);
  const base = `${date}-${slug}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  if (!isValidId(id)) fail('bad-id', `Invalid id: ${id}`);
  return id;
}

export function assertId(id) {
  if (!isValidId(id)) fail('bad-id', `Invalid change id: ${id}`);
  return id;
}
