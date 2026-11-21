import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, gitIn, writeFile, runScript } from './helpers.mjs';

function buggyRepo(t) {
  const dir = tempRepo(t);
  writeFile(dir, '.buggy/config.yaml', 'buggy: 1\n');
  gitIn(dir, ['add', '.']);
  gitIn(dir, ['commit', '-q', '-m', 'setup']);
  return dir;
}

// Input written exactly as a skill does it: a file in .buggy/.tmp/.
function input(dir, name, obj) {
  return writeFile(dir, `.buggy/.tmp/${name}.json`, JSON.stringify(obj));
}

test('ideas create: file from template, input file consumed', (t) => {
  const dir = buggyRepo(t);
  const inp = input(dir, 'idea-1', { title: 'Heatmapa aktywności', description: 'Jak na GitHubie.\n\n- rok, filtr' });
  const r = runScript('ideas', ['create', '--input', inp], { cwd: dir });
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.json.id, /^\d{8}-heatmapa-aktywnosci$/);
  const text = readFileSync(join(dir, r.json.path), 'utf8');
  assert.match(text, /^# Heatmapa aktywności\n/);
  assert.match(text, /## Description\n\nJak na GitHubie\.\n\n- rok, filtr\n/);
  assert.equal(existsSync(inp), false, 'input file deleted');
});

test('ideas list: working tree and other branches, ids unique across branches', (t) => {
  const dir = buggyRepo(t);
  gitIn(dir, ['switch', '-q', '-c', 'feature/20261118-other']);
  const a = runScript('ideas', ['create', '--input', input(dir, 'a', { title: 'Same name' })], { cwd: dir }).json;
  gitIn(dir, ['add', '.']);
  gitIn(dir, ['commit', '-q', '-m', 'idea a']);
  gitIn(dir, ['switch', '-q', 'main']);
  const b = runScript('ideas', ['create', '--input', input(dir, 'b', { title: 'Same name' })], { cwd: dir }).json;
  assert.equal(b.id, `${a.id}-2`, 'idea on another branch blocks the same id');

  const list = runScript('ideas', ['list'], { cwd: dir }).json;
  assert.equal(list.count, 2);
  const ia = list.ideas.find((i) => i.id === a.id);
  assert.equal(ia.inWorkingTree, false);
  assert.deepEqual(ia.branches, ['feature/20261118-other']);
  assert.equal(ia.title, 'Same name');
  const ib = list.ideas.find((i) => i.id === b.id);
  assert.equal(ib.inWorkingTree, true);
  assert.deepEqual(ib.branches, []);
});

test('ideas show: from the working tree or from another branch', (t) => {
  const dir = buggyRepo(t);
  gitIn(dir, ['switch', '-q', '-c', 'feature/20261118-other']);
  const a = runScript('ideas', ['create', '--input', input(dir, 'a', { title: 'Remote idea' })], { cwd: dir }).json;
  gitIn(dir, ['add', '.']);
  gitIn(dir, ['commit', '-q', '-m', 'idea']);
  gitIn(dir, ['switch', '-q', 'main']);
  const r = runScript('ideas', ['show', '--id', a.id], { cwd: dir }).json;
  assert.equal(r.inWorkingTree, false);
  assert.equal(r.branch, 'feature/20261118-other');
  assert.match(r.text, /^# Remote idea/);
  assert.equal(runScript('ideas', ['show', '--id', '20200101-nope'], { cwd: dir }).json.code, 'idea-not-found');
  assert.equal(runScript('ideas', ['show', '--id', '../x'], { cwd: dir }).json.code, 'bad-id');
});

test('ideas create: missing title is an error', (t) => {
  const dir = buggyRepo(t);
  const r = runScript('ideas', ['create', '--input', input(dir, 'x', { description: 'no title' })], { cwd: dir });
  assert.equal(r.json.code, 'bad-input');
});
