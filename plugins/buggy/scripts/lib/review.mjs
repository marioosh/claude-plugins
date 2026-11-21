// review.md: rounds of /buggy:review (D-12, D-26, stage 4 P1–P5).
//
//   ## Round N
//
//   - **Date:** 2026-11-19
//   - **Type:** incremental | final
//   - **Diff:** `abc1234` → working tree (3 files)
//   - **Checkpoint:** –                      (set by round-end)
//
//   | # | Source | Severity | Finding | Location | Decision | Status |
//   |---|---|---|---|---|---|---|
//   | R1.1 | code-reviewer | major | … | src/a.js:12 | fix | done |
//
// Rounds are inserted before "## Acceptance criteria check"; the rest of the
// file belongs to the user and the model.

import { fail } from './cli.mjs';
import { exists, readText, writeText, resolveInside } from './fsutil.mjs';
import { rmSync } from 'node:fs';
import { renderTemplate } from './templates.mjs';
import { changeDir } from './change-paths.mjs';
import { todayIso } from './ids.mjs';
import { git, gitOutput, status as gitStatus } from './git.mjs';
import { cell } from './history.mjs';

export const reviewPath = (id) => `${changeDir(id)}/review.md`;
export const SEVERITIES = ['blocker', 'major', 'minor', 'nit'];
export const DECISIONS = ['fix', 'reject', 'defer'];
export const FINDING_STATUSES = ['open', 'done'];
export const ROUND_TYPES = ['incremental', 'final'];
export const MAX_DIFF_BYTES = 2 * 1024 * 1024;

const ROUND_RE = /^## Round (\d+)[ \t]*$/;
const ROW_RE = /^\| (R\d+\.\d+) \|/;

function lines(text) {
  return { eol: text.includes('\r\n') ? '\r\n' : '\n', lines: text.split(/\r?\n/) };
}

function splitRow(line) {
  // cells of "| a | b \| c | d |" – escaped pipes stay inside a cell
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split(/(?<!\\)\|/).map((c) => c.trim());
}

export function parseReview(text) {
  const { lines: ls } = lines(text);
  const rounds = [];
  let cur = null;
  ls.forEach((l, i) => {
    const m = l.match(ROUND_RE);
    if (m) {
      cur = { n: Number(m[1]), start: i, type: null, base: null, checkpoint: null, findings: [], tableEnd: null };
      rounds.push(cur);
      return;
    }
    if (/^## /.test(l)) {
      cur = null;
      return;
    }
    if (!cur) return;
    const field = l.match(/^- \*\*(Type|Diff|Checkpoint):\*\* (.*)$/);
    if (field) {
      if (field[1] === 'Type') cur.type = field[2].trim();
      if (field[1] === 'Diff') cur.base = field[2].match(/`([0-9a-f]{7,40})`/)?.[1] ?? null;
      if (field[1] === 'Checkpoint') {
        const sha = field[2].match(/`([0-9a-f]{7,40})`/);
        cur.checkpoint = sha ? sha[1] : null;
        cur.checkpointLine = i;
      }
      return;
    }
    if (/^\|/.test(l)) cur.tableEnd = i;
    if (ROW_RE.test(l)) {
      const [fid, source, severity, finding, location, decision, st] = splitRow(l);
      cur.findings.push({ id: fid, source, severity, finding, location, decision, status: st, line: i });
    }
  });
  return { rounds };
}

export function lastRound(text) {
  const { rounds } = parseReview(text);
  return rounds[rounds.length - 1] ?? null;
}

export function initReview(root, id, title) {
  if (exists(root, reviewPath(id))) return false;
  writeText(root, reviewPath(id), renderTemplate(root, 'review.md', { title, id }).text, { exclusive: true });
  return true;
}

export function loadReview(root, id) {
  if (!exists(root, reviewPath(id))) fail('review-not-found', `No review yet: ${reviewPath(id)}. Run /buggy:review.`);
  return readText(root, reviewPath(id));
}

// Base commit of the next round's diff (D-26).
export async function diffBase(root, mainBranch, text, type) {
  const last = text ? lastRound(text) : null;
  if (type === 'final' || !last) {
    const base = await git(['merge-base', mainBranch, 'HEAD'], { cwd: root, allowFail: true });
    if (!base) fail('no-merge-base', `Cannot find where this branch left ${mainBranch}.`);
    return base;
  }
  const from = last.checkpoint ?? last.base;
  if (!from) fail('bad-review', 'The previous round has no checkpoint or base.');
  return (await git(['rev-parse', '--verify', `${from}^{commit}`], { cwd: root, allowFail: true })) ?? fail('bad-review', `Unknown commit ${from}.`);
}

// Diff from `base` to the working tree, untracked files included; the change's
// own documents and buggy's input files are left out (spec and plan are read separately).
export async function buildDiff(root, base, id) {
  const exclude = [`:(exclude)${changeDir(id)}`, ':(exclude).buggy/.tmp'];
  const tracked = await gitOutput(['diff', '--no-color', '--no-ext-diff', base, '--', '.', ...exclude], { cwd: root });
  const names = (await gitOutput(['diff', '--name-only', base, '--', '.', ...exclude], { cwd: root })).split('\n').filter(Boolean);
  const untracked = (await gitOutput(['ls-files', '--others', '--exclude-standard', '--', '.', ...exclude], { cwd: root }))
    .split('\n')
    .filter(Boolean);
  let patch = tracked;
  for (const f of untracked) {
    patch += await gitOutput(['diff', '--no-color', '--no-index', '--', '/dev/null', f], { cwd: root });
  }
  return { patch, files: [...names, ...untracked] };
}

const sh = (sha) => sha.slice(0, 7);

export async function startRound(root, id, { title, type, mainBranch }) {
  if (!ROUND_TYPES.includes(type)) fail('bad-arguments', `--type must be one of ${ROUND_TYPES.join(', ')}.`);
  initReview(root, id, title);
  const text = loadReview(root, id);
  const last = lastRound(text);
  if (last && !last.checkpoint) fail('round-open', `Round ${last.n} is not finished yet (run review round-end).`);
  const n = last ? last.n + 1 : 1;
  const base = await diffBase(root, mainBranch, text, type);
  const { patch, files } = await buildDiff(root, base, id);
  if (Buffer.byteLength(patch) > MAX_DIFF_BYTES) {
    fail('diff-too-large', `The diff is larger than ${MAX_DIFF_BYTES} bytes; review it in groups of files.`, { files });
  }
  const diffPath = `.buggy/.tmp/review-r${n}.patch`;
  writeText(root, diffPath, patch);

  const { eol, lines: ls } = lines(text);
  let at = ls.findIndex((l) => /^## Acceptance criteria check[ \t]*$/.test(l));
  if (at === -1) at = ls.length;
  const section = [
    `## Round ${n}`,
    '',
    `- **Date:** ${todayIso()}`,
    `- **Type:** ${type}`,
    `- **Diff:** \`${sh(base)}\` → working tree (${files.length} file${files.length === 1 ? '' : 's'})`,
    '- **Checkpoint:** –',
    '',
    '| # | Source | Severity | Finding | Location | Decision | Status |',
    '|---|---|---|---|---|---|---|',
    '',
  ];
  ls.splice(at, 0, ...section);
  writeText(root, reviewPath(id), ls.join(eol));
  return { round: n, type, base, diff: diffPath, files, bytes: Buffer.byteLength(patch) };
}

function openRound(text) {
  const last = lastRound(text);
  if (!last) fail('no-round', 'No review round yet (run review round-start).');
  if (last.checkpoint) fail('round-closed', `Round ${last.n} is finished; start a new round.`);
  return last;
}

function checkDecision(d) {
  if (d === undefined || d === null || d === '') return '–';
  if (typeof d !== 'string' || !DECISIONS.some((x) => d === x || d.startsWith(`${x} `))) {
    fail('bad-input', `decision must start with one of: ${DECISIONS.join(', ')}.`);
  }
  return d;
}

export function addFinding(root, id, f) {
  const text = loadReview(root, id);
  const round = openRound(text);
  if (typeof f.finding !== 'string' || f.finding.trim() === '') fail('bad-input', 'finding is required.');
  if (!SEVERITIES.includes(f.severity)) fail('bad-input', `severity must be one of: ${SEVERITIES.join(', ')}.`);
  const st = f.status ?? 'open';
  if (!FINDING_STATUSES.includes(st)) fail('bad-input', `status must be one of: ${FINDING_STATUSES.join(', ')}.`);
  const decision = checkDecision(f.decision);
  const fid = `R${round.n}.${round.findings.length + 1}`;
  const row = `| ${fid} | ${cell(f.source || 'user')} | ${f.severity} | ${cell(f.finding)} | ${cell(f.location) || '–'} | ${cell(decision)} | ${st} |`;
  const { eol, lines: ls } = lines(text);
  ls.splice(round.tableEnd + 1, 0, row);
  writeText(root, reviewPath(id), ls.join(eol));
  return { id: fid, row };
}

export function updateFinding(root, id, fid, { decision, status: st } = {}) {
  if (!/^R\d+\.\d+$/.test(fid ?? '')) fail('bad-arguments', '--finding must look like R1.2.');
  const text = loadReview(root, id);
  const f = parseReview(text).rounds.flatMap((r) => r.findings).find((x) => x.id === fid);
  if (!f) fail('finding-not-found', `No finding ${fid}.`);
  if (st !== undefined && !FINDING_STATUSES.includes(st)) fail('bad-input', `status must be one of: ${FINDING_STATUSES.join(', ')}.`);
  const { eol, lines: ls } = lines(text);
  const cells = splitRow(ls[f.line]);
  if (decision !== undefined) cells[5] = cell(checkDecision(decision));
  if (st !== undefined) cells[6] = st;
  ls[f.line] = `| ${cells.join(' | ')} |`;
  writeText(root, reviewPath(id), ls.join(eol));
  return { id: fid, decision: cells[5], status: cells[6] };
}

export async function endRound(root, id) {
  const text = loadReview(root, id);
  const round = openRound(text);
  const head = await git(['rev-parse', 'HEAD'], { cwd: root });
  const dirty = (await gitStatus(root)).filter((e) => !e.path.startsWith(`${changeDir(id)}/`)).length;
  const { eol, lines: ls } = lines(text);
  ls[round.checkpointLine] = `- **Checkpoint:** \`${sh(head)}\`${dirty ? ` (+ ${dirty} uncommitted file${dirty === 1 ? '' : 's'})` : ''}`;
  writeText(root, reviewPath(id), ls.join(eol));
  rmSync(resolveInside(root, `.buggy/.tmp/review-r${round.n}.patch`), { force: true });
  return { round: round.n, checkpoint: head, uncommitted: dirty };
}

// Gate for "approved" (P5): last round is final, finished and needed no fixes;
// every finding has a decision; every "fix" is done.
export function approvalGate(text) {
  const { rounds } = parseReview(text);
  const problems = [];
  const last = rounds[rounds.length - 1];
  if (!last) problems.push('No review round yet.');
  else {
    if (last.type !== 'final') problems.push(`The last round (${last.n}) is not a final round.`);
    if (!last.checkpoint) problems.push(`The last round (${last.n}) is not finished.`);
    // A fix made during the final round was not reviewed itself (D-26): run another final round.
    if (last.type === 'final' && last.findings.some((f) => f.decision.startsWith('fix'))) {
      problems.push(`The final round (${last.n}) led to fixes; run another final round to review them.`);
    }
  }
  for (const f of rounds.flatMap((r) => r.findings)) {
    if (f.decision === '–' || f.decision === '') problems.push(`${f.id} has no decision.`);
    else if (f.decision.startsWith('fix') && f.status !== 'done') problems.push(`${f.id} is to be fixed and is not done.`);
  }
  return { ok: problems.length === 0, problems };
}

export function reviewSummary(text) {
  const { rounds } = parseReview(text);
  const findings = rounds.flatMap((r) => r.findings);
  return {
    rounds: rounds.length,
    lastRound: rounds.length ? { n: rounds.at(-1).n, type: rounds.at(-1).type, finished: Boolean(rounds.at(-1).checkpoint) } : null,
    findings: findings.length,
    open: findings.filter((f) => f.decision === '–' || (f.decision.startsWith('fix') && f.status !== 'done')).length,
  };
}
