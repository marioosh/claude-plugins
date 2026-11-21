import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, tempDir, gitIn, writeFile, runScript } from './helpers.mjs';
import { loadConfig } from '../plugins/buggy/scripts/lib/config.mjs';

let k = 0;
const input = (dir, obj) => writeFile(dir, `.buggy/.tmp/i-${k++}.json`, JSON.stringify(obj));
const sh = (dir, args, obj) => runScript('setup', obj ? [...args, '--input', input(dir, obj)] : args, { cwd: dir });

// ---------- detect ----------

test('detect: empty folder without git → 1.1', (t) => {
  const d = sh(tempDir(t), ['detect']).json;
  assert.deepEqual([d.git, d.files, d.codeFiles, d.proposedCase], [false, 0, 0, '1.1']);
});

test('detect: git repository without commits → 1.1, hasCommits false', (t) => {
  const dir = tempRepo(t, { commit: false });
  const d = sh(dir, ['detect']).json;
  assert.equal(d.hasCommits, false);
  assert.equal(d.proposedCase, '1.1');
});

test('detect: code without SDD → 1.2 with manifests, version candidates, origin', (t) => {
  const dir = tempRepo(t);
  writeFile(dir, 'package.json', '{ "name": "x", "version": "1.4.2" }\n');
  writeFile(dir, 'src/index.js', 'export {}\n');
  writeFile(dir, 'node_modules/dep/index.js', 'ignored\n');
  gitIn(dir, ['add', 'package.json', 'src']);
  gitIn(dir, ['commit', '-q', '-m', 'code']);
  gitIn(dir, ['tag', 'v1.4.0']);
  gitIn(dir, ['remote', 'add', 'origin', 'https://example.com/acme/x.git']);
  const d = sh(dir, ['detect']).json;
  assert.equal(d.proposedCase, '1.2');
  assert.deepEqual(d.manifests, ['package.json']);
  assert.equal(d.codeFiles, 1, 'node_modules skipped');
  assert.deepEqual(d.versionCandidates, [
    { source: 'package.json', value: '1.4.2', key: 'version', valid: true },
    { source: 'tag', value: '1.4.0', valid: true },
  ]);
  assert.equal(d.origin, 'https://example.com/acme/x.git');
  assert.deepEqual(d.mainCandidates, ['main']);
});

test('detect: a Darters.Zone-like project → 1.3 with SDD markers and Claude files', (t) => {
  const dir = tempRepo(t);
  writeFile(dir, 'version.txt', '0.6.4\n');
  writeFile(dir, 'mix.exs', 'version: "version.txt" |> File.read!()\n');
  writeFile(dir, 'lib/app.ex', 'defmodule App do end\n');
  writeFile(dir, 'features/0.6.4_feature-fixes.md', '# x\n');
  writeFile(dir, 'features/ROADMAP.md', '# r\n');
  writeFile(dir, 'releases/0.6.4 - 2026-11-17 - Club.md', '# n\n');
  writeFile(dir, 'docs/FUNCTIONAL_SPEC.md', '# spec\n');
  writeFile(dir, 'CLAUDE.md', '# guide\n');
  writeFile(dir, '.claude/skills/feature-workflow/SKILL.md', 'x');
  writeFile(dir, '.claude/settings.json', '{ "permissions": { "allow": ["Bash(mix test:*)", "Bash(git status)"] } }');
  writeFile(dir, '.githooks/post-commit', '#!/bin/sh\n');
  gitIn(dir, ['config', 'core.hooksPath', '.githooks']);
  const d = sh(dir, ['detect']).json;
  assert.equal(d.proposedCase, '1.3');
  const paths = d.sddMarkers.map((m) => m.path);
  for (const p of ['features/', 'releases/', 'features/ROADMAP.md', 'docs/FUNCTIONAL_SPEC.md', '(version-named documents)']) assert.ok(paths.includes(p), p);
  assert.deepEqual(d.versionCandidates[0], { source: 'version.txt', value: '0.6.4', valid: true });
  assert.equal(d.versionCandidates[1].note, 'reads version.txt');
  assert.deepEqual(d.claude.skills, ['feature-workflow']);
  assert.equal(d.claude.allowRules, 2);
  assert.equal(d.hooks.hooksPath, '.githooks');
});

test('detect: buggy already set up → existing', (t) => {
  const dir = tempRepo(t);
  writeFile(dir, '.buggy/config.yaml', 'buggy: 1\n');
  assert.equal(sh(dir, ['detect']).json.proposedCase, 'existing');
});

// ---------- branch, init, CLAUDE.md block ----------

test('branch: chore/<date>-buggy-setup from main; dirty tree refused; no commits refused', (t) => {
  const dir = tempRepo(t);
  writeFile(dir, 'wip.txt', 'x');
  const dirty = sh(dir, ['branch']).json;
  assert.equal(dirty.code, 'dirty-tree');
  assert.deepEqual(dirty.details.files, ['wip.txt']);
  gitIn(dir, ['add', '.']);
  gitIn(dir, ['commit', '-q', '-m', 'wip']);
  const r = sh(dir, ['branch']).json;
  assert.match(r.branch, /^chore\/\d{8}-buggy-setup$/);
  assert.equal(gitIn(dir, ['branch', '--show-current']), r.branch);
  assert.equal(sh(tempRepo(t, { commit: false }), ['branch']).json.code, 'no-commits');
});

test('init: valid config, .gitignore, version file only when missing; refused twice; bad values', (t) => {
  const dir = tempRepo(t);
  const r = sh(dir, ['init'], { mainBranch: 'main', language: { docs: 'pl' } }).json;
  assert.equal(r.status, 'ok', JSON.stringify(r));
  assert.deepEqual(r.created, ['.buggy/config.yaml', '.buggy/.gitignore', 'version.txt']);
  assert.equal(readFileSync(join(dir, 'version.txt'), 'utf8'), '0.0.0\n');
  assert.equal(readFileSync(join(dir, '.buggy/.gitignore'), 'utf8'), '.tmp/\n');
  const cfg = loadConfig(dir);
  assert.equal(cfg.language.docs, 'pl');
  assert.equal(cfg.version.file, 'version.txt');
  assert.equal(sh(dir, ['init'], {}).json.code, 'already-set-up');

  const js = tempRepo(t);
  writeFile(js, 'package.json', '{ "version": "1.4.2" }\n');
  const r2 = sh(js, ['init'], { version: { file: 'package.json' } }).json;
  assert.equal(r2.versionWritten, null);
  assert.equal(loadConfig(js).version.key, 'version');
  assert.equal(sh(tempRepo(t), ['init'], { language: { docs: 'polish' } }).json.code, 'bad-config');
  assert.equal(sh(tempRepo(t), ['init'], { version: { file: 'package.json' } }).json.code, 'version-file-missing');
  const keep = tempRepo(t);
  writeFile(keep, 'version.txt', '0.6.4\n');
  sh(keep, ['init'], {});
  assert.equal(readFileSync(join(keep, 'version.txt'), 'utf8'), '0.6.4\n');
});

test('claude-block: created, appended, updated, unchanged – the rest of CLAUDE.md is kept', (t) => {
  const dir = tempRepo(t);
  assert.equal(sh(dir, ['claude-block']).json.result, 'created');
  assert.match(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), /^# Project guide for Claude\n\n<!-- buggy:begin -->\n## buggy/);
  const other = tempRepo(t);
  writeFile(other, 'CLAUDE.md', '# Guide\n\nStack: Elixir.\n');
  assert.equal(sh(other, ['claude-block']).json.result, 'appended');
  assert.equal(sh(other, ['claude-block']).json.result, 'unchanged');
  const text = readFileSync(join(other, 'CLAUDE.md'), 'utf8');
  assert.ok(text.startsWith('# Guide\n\nStack: Elixir.\n\n<!-- buggy:begin -->'));
  writeFile(other, 'CLAUDE.md', text.replace('## buggy', '## old buggy text') + '\n## After\n');
  assert.equal(sh(other, ['claude-block']).json.result, 'updated');
  const after = readFileSync(join(other, 'CLAUDE.md'), 'utf8');
  assert.ok(!after.includes('old buggy text'));
  assert.ok(after.endsWith('<!-- buggy:end -->\n\n## After\n'));
  writeFile(other, 'CLAUDE.md', '# x\n<!-- buggy:begin -->\n');
  assert.equal(sh(other, ['claude-block']).json.code, 'bad-block');
});

// ---------- move and stub ----------

test('move + stub in two commits keep the history of a moved document (D-33)', (t) => {
  const dir = tempRepo(t);
  writeFile(dir, 'docs/FUNCTIONAL_SPEC.md', '# Spec\n\nACC-01 Accounts.\n');
  writeFile(dir, 'features/0.2.0_feature-x.md', '# 0.2.0\n');
  gitIn(dir, ['add', '.']);
  gitIn(dir, ['commit', '-q', '-m', 'old spec']);
  let r = sh(dir, ['move'], { moves: [{ from: 'docs/FUNCTIONAL_SPEC.md', to: '.buggy/requirements.md' }, { from: 'features', to: 'archive/features' }] });
  assert.equal(r.code, 0, r.stdout);
  assert.ok(existsSync(join(dir, 'archive/features/0.2.0_feature-x.md')));
  gitIn(dir, ['commit', '-q', '-m', 'move']);
  r = sh(dir, ['stub'], { stubs: [{ path: 'docs/FUNCTIONAL_SPEC.md', target: '.buggy/requirements.md' }] });
  assert.equal(r.code, 0, r.stdout);
  assert.match(readFileSync(join(dir, 'docs/FUNCTIONAL_SPEC.md'), 'utf8'), /moved to `\.buggy\/requirements\.md` on \d{4}-\d{2}-\d{2}/);
  gitIn(dir, ['add', '.']);
  gitIn(dir, ['commit', '-q', '-m', 'stub']);
  assert.deepEqual(gitIn(dir, ['log', '--follow', '--format=%s', '--', '.buggy/requirements.md']).split('\n'), ['move', 'old spec']);
});

test('move and stub refuse unsafe or impossible paths', (t) => {
  const dir = tempRepo(t);
  writeFile(dir, 'a.md', 'a');
  writeFile(dir, 'b.md', 'b');
  gitIn(dir, ['add', '.']);
  gitIn(dir, ['commit', '-q', '-m', 'files']);
  assert.equal(sh(dir, ['move'], { moves: [{ from: 'a.md', to: 'b.md' }] }).json.code, 'already-exists');
  assert.equal(sh(dir, ['move'], { moves: [{ from: 'a.md', to: '../out.md' }] }).json.code, 'path-outside-repo');
  assert.equal(sh(dir, ['move'], { moves: [{ from: 'nope.md', to: 'x.md' }] }).json.code, 'not-found');
  assert.equal(sh(dir, ['move'], { moves: [] }).json.code, 'bad-input');
  assert.equal(sh(dir, ['move'], { moves: [{ from: 'a.md', to: 'ideas/2026-11-20-events.md' }] }).json.code, 'bad-idea-name');
  assert.equal(sh(dir, ['stub'], { stubs: [{ path: 'a.md', target: 'x' }] }).json.code, 'already-exists');
  assert.equal(sh(dir, ['move'], { moves: [{ from: 'b.md', to: 'ideas/20261120-events.md' }] }).code, 0, 'a valid idea name');
});
