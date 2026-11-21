// history.md: the implementation log of a change. Rows of the first table are
// appended by a script (stage 3 P3), so the format stays the same everywhere.

import { fail } from './cli.mjs';
import { exists, readText, writeText } from './fsutil.mjs';
import { renderTemplate } from './templates.mjs';
import { changeDir } from './change-paths.mjs';
import { todayIso } from './ids.mjs';

export const historyPath = (id) => `${changeDir(id)}/history.md`;

export function initHistory(root, id, title) {
  if (exists(root, historyPath(id))) return { created: false, path: historyPath(id) };
  writeText(root, historyPath(id), renderTemplate(root, 'history.md', { title, id }).text, { exclusive: true });
  return { created: true, path: historyPath(id) };
}

// Table cell: no line breaks, `|` escaped.
export function cell(v) {
  return String(v ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

export function addRow(root, id, { step, change, files = [], notes = '' }, date = todayIso()) {
  if (typeof change !== 'string' || change.trim() === '') fail('bad-input', 'change is required.');
  if (!Array.isArray(files) || files.some((f) => typeof f !== 'string')) fail('bad-input', 'files must be a list of paths.');
  if (!exists(root, historyPath(id))) fail('history-not-found', `No history yet: ${historyPath(id)}.`);
  const text = readText(root, historyPath(id));
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const header = lines.findIndex((l) => /^\|\s*Date\s*\|/.test(l));
  if (header === -1 || !/^\|[-|\s:]+\|$/.test(lines[header + 1] ?? '')) {
    fail('bad-history', `${historyPath(id)} has no "| Date | Step | …" table.`);
  }
  let last = header + 1;
  while (last + 1 < lines.length && lines[last + 1].startsWith('|')) last++;
  const stepCell = step === undefined || step === null || step === '' ? '–' : /^\d+$/.test(String(step)) ? `S${step}` : String(step);
  const row = `| ${date} | ${cell(stepCell)} | ${cell(change)} | ${files.length ? files.map((f) => `\`${cell(f)}\``).join(', ') : '–'} | ${cell(notes) || '–'} |`;
  lines.splice(last + 1, 0, row);
  writeText(root, historyPath(id), lines.join(eol));
  return { row };
}
