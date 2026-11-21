// A strict subset of YAML for `.buggy/config.yaml` and Markdown frontmatter.
// buggy has no npm dependencies (D-24), so it parses only what it writes:
//
//   key: value              scalars: plain or quoted strings, integers,
//                           true/false, null/~
//   key:                    nested map (2-space indentation, any depth)
//     child: value
//   key:                    list of scalars
//     - item
//   key: []                 empty list;  key: [a, b]  flow list of scalars
//   # comment               full-line or after a value (` #`)
//
// Anything else (anchors, multi-line strings, lists of maps, tabs…) is a
// `bad-yaml` error instead of a guess. Values such as 0.6.4 or 2026-11-19 stay
// strings: only plain integers become numbers.

import { fail } from './cli.mjs';

const KEY = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;

function bad(lineNo, msg) {
  fail('bad-yaml', `YAML line ${lineNo}: ${msg}`);
}

function stripComment(s) {
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"') i++;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#' && (i === 0 || s[i - 1] === ' ')) {
      return s.slice(0, i);
    }
  }
  return s;
}

function parseScalar(raw, lineNo) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?(0|[1-9]\d*)$/.test(s)) return Number(s);
  if (s.startsWith('"')) {
    if (!s.endsWith('"') || s.length < 2) bad(lineNo, 'unterminated double-quoted string');
    try {
      return JSON.parse(s);
    } catch {
      bad(lineNo, 'invalid double-quoted string');
    }
  }
  if (s.startsWith("'")) {
    if (!s.endsWith("'") || s.length < 2) bad(lineNo, 'unterminated single-quoted string');
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (/^[&*!|>%@`{]/.test(s)) bad(lineNo, `unsupported YAML syntax: ${s}`);
  if (s.startsWith('[')) {
    if (!s.endsWith(']')) bad(lineNo, 'unterminated flow list');
    const inner = s.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((x) => {
      const v = parseScalar(x, lineNo);
      if (Array.isArray(v)) bad(lineNo, 'nested lists are not supported');
      return v;
    });
  }
  return s;
}

export function parse(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const items = [];
  lines.forEach((line, i) => {
    const lineNo = i + 1;
    if (/\t/.test(line.match(/^\s*/)[0])) bad(lineNo, 'tabs are not allowed for indentation');
    const content = stripComment(line).replace(/\s+$/, '');
    if (content.trim() === '') return;
    const indent = content.match(/^ */)[0].length;
    if (indent % 2 !== 0) bad(lineNo, 'indentation must be a multiple of 2 spaces');
    items.push({ indent, text: content.slice(indent), lineNo });
  });

  let pos = 0;
  function parseBlock(indent) {
    const first = items[pos];
    if (first.text.startsWith('- ') || first.text === '-') {
      const list = [];
      while (pos < items.length && items[pos].indent === indent) {
        const it = items[pos];
        if (!(it.text.startsWith('- ') || it.text === '-')) bad(it.lineNo, 'mixing list items and keys');
        const raw = it.text === '-' ? '' : it.text.slice(2).trim();
        if (/^[A-Za-z0-9_-]+:( |$)/.test(raw)) bad(it.lineNo, 'lists of maps are not supported');
        const v = parseScalar(raw, it.lineNo);
        if (Array.isArray(v)) bad(it.lineNo, 'nested lists are not supported');
        list.push(v);
        pos++;
      }
      if (pos < items.length && items[pos].indent > indent) bad(items[pos].lineNo, 'unexpected indentation');
      return list;
    }
    const map = {};
    while (pos < items.length && items[pos].indent === indent) {
      const it = items[pos];
      const m = it.text.match(/^([^:\s][^:]*?):(?: (.*)|)$/);
      if (!m) bad(it.lineNo, `expected "key: value", got: ${it.text}`);
      const key = m[1];
      if (!KEY.test(key)) bad(it.lineNo, `invalid key: ${key}`);
      if (Object.hasOwn(map, key)) bad(it.lineNo, `duplicate key: ${key}`);
      pos++;
      const rest = m[2] === undefined ? '' : m[2].trim();
      if (rest !== '') {
        map[key] = parseScalar(rest, it.lineNo);
      } else if (pos < items.length && items[pos].indent > indent) {
        if (items[pos].indent !== indent + 2) bad(items[pos].lineNo, 'indentation must increase by 2 spaces');
        map[key] = parseBlock(indent + 2);
      } else {
        map[key] = null;
      }
    }
    if (pos < items.length && items[pos].indent > indent) bad(items[pos].lineNo, 'unexpected indentation');
    return map;
  }

  if (items.length === 0) return {};
  if (items[0].indent !== 0) bad(items[0].lineNo, 'document must start at column 0');
  const result = parseBlock(0);
  if (pos < items.length) bad(items[pos].lineNo, 'unexpected content');
  if (Array.isArray(result)) bad(items[0].lineNo, 'top level must be a map');
  return result;
}

function needsQuotes(s) {
  return (
    s === '' ||
    s !== s.trim() ||
    /^(true|false|null|~|-?(0|[1-9]\d*))$/.test(s) ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(s) ||
    /: |\s#|[\n\r\t]/.test(s) ||
    s.endsWith(':')
  );
}

function scalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) fail('bad-yaml', `Only integers are supported, got ${v}`);
    return String(v);
  }
  if (typeof v === 'string') return needsQuotes(v) ? JSON.stringify(v) : v;
  fail('bad-yaml', `Unsupported value type: ${typeof v}`);
}

export function stringify(obj, indent = 0) {
  const pad = ' '.repeat(indent);
  let out = '';
  for (const [k, v] of Object.entries(obj)) {
    if (!KEY.test(k)) fail('bad-yaml', `Invalid key: ${k}`);
    if (Array.isArray(v)) {
      if (v.length === 0) out += `${pad}${k}: []\n`;
      else {
        out += `${pad}${k}:\n`;
        for (const item of v) {
          if (item !== null && typeof item === 'object') fail('bad-yaml', 'Lists of maps are not supported');
          out += `${pad}  - ${scalar(item)}\n`;
        }
      }
    } else if (v !== null && typeof v === 'object') {
      out += `${pad}${k}:\n${stringify(v, indent + 2)}`;
    } else {
      out += `${pad}${k}: ${scalar(v)}\n`;
    }
  }
  return out;
}

// Markdown frontmatter: a document starting with a `---` line, closed by the next `---` line.
export function splitFrontmatter(md) {
  const text = md.replace(/^﻿/, '');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: null, body: text };
  return { data: parse(m[1]), body: text.slice(m[0].length) };
}

export function joinFrontmatter(data, body) {
  return `---\n${stringify(data)}---\n${body}`;
}
