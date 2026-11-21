// plan.md: the "## Steps" checklist that /buggy:implement works through (D-20).
//
//   - [ ] S1. Text of the step
//   - [x] S2. Done step
//
// Only lines inside the "## Steps" section count; the rest of the file is kept
// byte for byte when a step is ticked or added.

import { fail } from './cli.mjs';
import { exists, readText, writeText } from './fsutil.mjs';
import { renderTemplate } from './templates.mjs';
import { changeDir } from './change-paths.mjs';

export const STEP_RE = /^- \[( |x|X)\] S(\d+)\.[ \t]*(.*?)[ \t]*$/;
export const planPath = (id) => `${changeDir(id)}/plan.md`;

function splitLines(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return { eol, lines: text.split(/\r?\n/) };
}

// Line range [start, end) of the "## Steps" section (heading excluded), or null.
function stepsSection(lines) {
  const start = lines.findIndex((l) => /^##[ \t]+Steps[ \t]*$/.test(l));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}[ \t]/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start: start + 1, end };
}

export function parseSteps(text) {
  const { lines } = splitLines(text);
  const sec = stepsSection(lines);
  if (!sec) return { section: false, steps: [] };
  const steps = [];
  for (let i = sec.start; i < sec.end; i++) {
    const m = lines[i].match(STEP_RE);
    if (m) steps.push({ n: Number(m[2]), text: m[3], done: m[1] !== ' ', line: i });
  }
  return { section: true, steps };
}

// Problems that block planning (status "planned").
export function checkSteps(text) {
  const { section, steps } = parseSteps(text);
  const problems = [];
  if (!section) problems.push('No "## Steps" section.');
  else if (steps.length === 0) problems.push('The "## Steps" section has no steps ("- [ ] S1. …").');
  steps.forEach((s, i) => {
    if (s.n !== i + 1) problems.push(`Step ${i + 1} is numbered S${s.n} (expected S${i + 1}).`);
    if (s.text === '') problems.push(`Step S${s.n} has no text.`);
  });
  return { ok: problems.length === 0, steps: steps.map(({ n, text, done }) => ({ n, text, done })), problems };
}

export function progress(text) {
  const { steps } = parseSteps(text);
  return { done: steps.filter((s) => s.done).length, total: steps.length };
}

export function loadPlan(root, id) {
  if (!exists(root, planPath(id))) fail('plan-not-found', `No plan yet: ${planPath(id)}. Run /buggy:plan.`);
  return readText(root, planPath(id));
}

export function initPlan(root, id, title) {
  if (exists(root, planPath(id))) return { created: false, path: planPath(id) };
  writeText(root, planPath(id), renderTemplate(root, 'plan.md', { title, id }).text, { exclusive: true });
  return { created: true, path: planPath(id) };
}

export function tickStep(root, id, n) {
  const text = loadPlan(root, id);
  const { eol, lines } = splitLines(text);
  const step = parseSteps(text).steps.find((s) => s.n === n);
  if (!step) fail('step-not-found', `There is no step S${n} in the plan.`);
  if (step.done) fail('step-done', `Step S${n} is already checked.`);
  lines[step.line] = lines[step.line].replace('- [ ]', '- [x]');
  writeText(root, planPath(id), lines.join(eol));
  return { n, text: step.text };
}

// Adds a step at the end of the list (small fixes during implementation, D-11).
export function addStep(root, id, stepText) {
  if (typeof stepText !== 'string' || stepText.trim() === '' || /[\r\n]/.test(stepText)) {
    fail('bad-input', 'text must be a single, non-empty line.');
  }
  const text = loadPlan(root, id);
  const { eol, lines } = splitLines(text);
  const { section, steps } = parseSteps(text);
  if (!section || steps.length === 0) fail('plan-invalid', 'The plan has no steps to extend.');
  const last = steps[steps.length - 1];
  const n = last.n + 1;
  lines.splice(last.line + 1, 0, `- [ ] S${n}. ${stepText.trim()}`);
  writeText(root, planPath(id), lines.join(eol));
  return { n, text: stepText.trim() };
}
