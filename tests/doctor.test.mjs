import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, gitIn, writeFile, runScript, GIT_ENV } from './helpers.mjs';
import { runDoctor } from '../plugins/buggy/scripts/lib/doctor.mjs';

Object.assign(process.env, GIT_ENV);

const SHIPPED = (id, v) => `---\nid: ${id}\ntitle: A\nchange: minor\nbase_version: 0.6.4\nstatus: shipped\nbranch: feature/${id}\nversion: ${v}\nshipped: 2026-11-19\n---\n# A\n`;

// A healthy project after one release (0.7.0), hooks installed, tags in place.
function healthy(t) {
  const dir = tempRepo(t);
  writeFile(dir, '.buggy/config.yaml', 'buggy: 1\n');
  writeFile(dir, '.buggy/.gitignore', '.tmp/\n');
  writeFile(dir, 'version.txt', '0.7.0\n');
  writeFile(dir, 'releases/0.7.0-a/spec.md', SHIPPED('20261119-a', '0.7.0'));
  writeFile(dir, 'releases/0.7.0-a/release-note.md', '# 0.7.0 — 2026-11-19 — A\n');
  runScript('githooks', ['install', '--mode', 'fresh'], { cwd: dir });
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['commit', '-q', '-m', 'release 0.7.0']); // the hook tags v0.7.0 and buggy-init
  return dir;
}
const codes = async (dir, opts) => (await runDoctor(dir, opts)).findings.map((f) => f.code).sort();
const commit = (dir, msg = 'x') => {
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['commit', '-q', '-m', msg]);
};

test('a healthy project has no findings; doctor.mjs check reports ok', async (t) => {
  const dir = healthy(t);
  assert.deepEqual(await codes(dir), []);
  const r = runScript('doctor', ['check'], { cwd: dir });
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual([r.json.ok, r.json.errors, r.json.warnings], [true, 0, 0]);
});

test('config, gitignore and leftovers', async (t) => {
  const dir = healthy(t);
  writeFile(dir, '.buggy/.gitignore', 'other\n');
  writeFile(dir, '.buggy/.tmp/old.json', '{}');
  assert.deepEqual(await codes(dir), ['gitignore-tmp', 'tmp-leftovers']);
  writeFile(dir, '.buggy/config.yaml', 'buggy: 9\n');
  const r = await runDoctor(dir);
  assert.equal(r.ok, false);
  assert.deepEqual(r.findings.map((f) => f.code), ['config-invalid']);
});

test('versions: sources differ, untagged main, tag ahead, tag outside main', async (t) => {
  const dir = healthy(t);
  writeFile(dir, 'package.json', '{ "version": "0.6.0" }\n');
  assert.deepEqual(await codes(dir), ['version-sources-differ']);
  unlinkSync(join(dir, 'package.json'));
  gitIn(dir, ['tag', 'v9.0.0']);
  assert.deepEqual(await codes(dir), ['tag-ahead']);
  gitIn(dir, ['tag', '-d', 'v9.0.0', 'v0.7.0']);
  assert.deepEqual(await codes(dir), ['main-untagged', 'release-untagged']);
  gitIn(dir, ['switch', '-q', '-c', 'side']);
  writeFile(dir, 'side.txt', 's');
  commit(dir);
  gitIn(dir, ['tag', 'v0.7.0']);
  gitIn(dir, ['switch', '-q', 'main']);
  assert.deepEqual(await codes(dir), ['tag-not-on-main']);
});

test('the hook and buggy must read the same version (D-27)', async (t) => {
  const dir = tempRepo(t);
  writeFile(dir, '.buggy/config.yaml', 'buggy: 1\nversion:\n  file: package.json\n');
  writeFile(dir, '.buggy/.gitignore', '.tmp/\n');
  writeFile(dir, 'package.json', '{\n  "version":\n    "1.0.0"\n}\n'); // valid JSON, but the sh pattern needs one line
  runScript('githooks', ['install', '--mode', 'fresh'], { cwd: dir });
  commit(dir);
  assert.ok((await codes(dir)).includes('hook-version-mismatch'));
});

test('hooks missing and buggy-init missing', async (t) => {
  const dir = healthy(t);
  gitIn(dir, ['config', '--unset', 'core.hooksPath']);
  gitIn(dir, ['tag', '-d', 'buggy-init']);
  assert.deepEqual(await codes(dir), ['buggy-init-missing', 'hooks-not-installed']);
});

test('changes: shipped not moved, missing plan/history/review, spec changed, no branch, stale', async (t) => {
  const dir = healthy(t);
  const spec = (id, status, extra = '') =>
    `---\nid: ${id}\ntitle: X\nchange: minor\nbase_version: 0.7.0\nstatus: ${status}\nbranch: feature/${id}\n${extra}---\n# X\n`;
  writeFile(dir, 'changes/20261101-shipped/spec.md', spec('20261101-shipped', 'shipped'));
  writeFile(dir, 'changes/20261102-review/spec.md', spec('20261102-review', 'in-review'));
  writeFile(dir, 'changes/20261103-clar/spec.md', spec('20261103-clar', 'clarified', 'spec_hash: 0000000000000000\n'));
  writeFile(dir, 'changes/not-an-id/spec.md', 'x');
  for (const id of ['20261102-review', '20261103-clar']) gitIn(dir, ['branch', `feature/${id}`]);
  const found = await codes(dir);
  for (const c of ['change-shipped-not-moved', 'change-plan-missing', 'change-history-missing', 'change-review-missing', 'change-spec-changed', 'change-broken']) {
    assert.ok(found.includes(c), c);
  }
  assert.ok(!found.includes('change-no-branch'), 'branches exist');
  rmSync(join(dir, 'changes/20261103-clar'), { recursive: true });
  gitIn(dir, ['branch', '-D', 'feature/20261102-review']);
  assert.ok((await codes(dir)).includes('change-no-branch'));
});

test('stale changes are found on their branches, also when doctor runs on main', async (t) => {
  const dir = healthy(t);
  const id = '20261020-old';
  gitIn(dir, ['switch', '-q', '-c', `feature/${id}`]);
  writeFile(dir, `changes/${id}/spec.md`, `---\nid: ${id}\ntitle: Old\nchange: minor\nbase_version: 0.7.0\nstatus: draft\nbranch: feature/${id}\n---\n# Old\n`);
  commit(dir, 'start old');
  gitIn(dir, ['switch', '-q', 'main']);
  assert.deepEqual(await codes(dir), [], 'fresh enough');
  const later = Date.now() + 40 * 86_400_000;
  const stale = (await runDoctor(dir, { now: later })).findings.find((f) => f.code === 'change-stale');
  assert.match(stale.message, /^20261020-old \(draft, branch feature\/20261020-old\) has had no commits for 40 days/);
  assert.match(stale.fix, /abandon/);
});

test('releases and ideas: folder names, version in spec, tags', async (t) => {
  const dir = healthy(t);
  writeFile(dir, 'releases/notes/spec.md', 'x');
  writeFile(dir, 'releases/0.6.0-old/spec.md', SHIPPED('20261001-old', '0.5.0'));
  writeFile(dir, 'ideas/Heatmap.md', '# x\n');
  writeFile(dir, 'ideas/20261119-ok.md', '# ok\n');
  assert.deepEqual(await codes(dir), ['idea-bad-name', 'release-bad-folder', 'release-untagged', 'release-version-mismatch']);
});

test('an outdated buggy block in CLAUDE.md is reported; setup claude-block refreshes it', async (t) => {
  const dir = healthy(t);
  assert.equal(runScript('setup', ['claude-block'], { cwd: dir }).code, 0);
  commit(dir, 'block');
  assert.deepEqual(await codes(dir), []);
  const path = join(dir, 'CLAUDE.md');
  writeFile(dir, 'CLAUDE.md', readFileSync(path, 'utf8').replace('`/buggy:release`,', ''));
  assert.deepEqual(await codes(dir), ['claude-block-outdated']);
  assert.equal(runScript('setup', ['claude-block'], { cwd: dir }).json.result, 'updated');
  assert.deepEqual(await codes(dir), []);
});

test('a literal version in mix.exs or pyproject.toml is reported; reading the version file is fine', async (t) => {
  const dir = healthy(t);
  const mix = (version) => `defmodule X.MixProject do\n  use Mix.Project\n\n  def project do\n    [\n      apps_path: "apps",\n      ${version},\n      releases: [x: [burrito: [targets: [m: [erts: {:precompiled, version: "29.1.2"}]]]]]\n    ]\n  end\n\n  defp deps, do: [{:burrito, "~> 1.6"}]\nend\n`;
  writeFile(dir, 'mix.exs', mix('version: "0.7.0"'));
  assert.deepEqual(await codes(dir), ['version-hardcoded']);
  writeFile(dir, 'mix.exs', mix('version: "0.6.0"'));
  assert.deepEqual(await codes(dir), ['version-hardcoded', 'version-sources-differ']);
  writeFile(dir, 'mix.exs', mix('version: "version.txt" |> File.read!() |> String.trim()'));
  assert.deepEqual(await codes(dir), []);
  writeFile(dir, 'pyproject.toml', '[project]\nname = "x"\nversion = "0.7.0"\n');
  assert.deepEqual(await codes(dir), ['version-hardcoded']);
});
