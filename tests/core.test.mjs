import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as yaml from '../plugins/buggy/scripts/lib/yaml.mjs';
import * as ids from '../plugins/buggy/scripts/lib/ids.mjs';
import * as semver from '../plugins/buggy/scripts/lib/semver.mjs';

function code(fn) {
  try {
    fn();
  } catch (e) {
    return e.code;
  }
  return 'no-error';
}

// ---------- yaml ----------

test('yaml: scalars, nesting, lists, comments', () => {
  const text = `# config
buggy: 1
main_branch: main   # default
version:
  file: version.txt
language:
  docs: pl
  exceptions:
    - "code comments: fi"
    - .buggy/ui.md
empty: []
flow: [a, 2, true]
nothing:
version_str: 0.6.4
date: 2026-11-19
quoted: 'it''s'
hash: "a # not a comment"
`;
  assert.deepEqual(yaml.parse(text), {
    buggy: 1,
    main_branch: 'main',
    version: { file: 'version.txt' },
    language: { docs: 'pl', exceptions: ['code comments: fi', '.buggy/ui.md'] },
    empty: [],
    flow: ['a', 2, true],
    nothing: null,
    version_str: '0.6.4',
    date: '2026-11-19',
    quoted: "it's",
    hash: 'a # not a comment',
  });
});

test('yaml: round trip keeps values and types', () => {
  const obj = {
    id: '20261119-club-meetings',
    title: 'Club: meeting places',
    change: 'minor',
    base_version: '0.6.4',
    status: 'draft',
    from_idea: null,
    count: 3,
    flag: false,
    tricky: ['true', '42', '', ' x', '#tag', '- dash', 'a: b'],
    nested: { a: { b: 'c' } },
    none: [],
  };
  assert.deepEqual(yaml.parse(yaml.stringify(obj)), obj);
});

test('yaml: unsupported syntax is an error, not a guess', () => {
  for (const bad of [
    'a: &anchor x',
    'a: |\n  text',
    'list:\n  - a: 1',
    'a:\n\tb: 1',
    'a:\n   b: 1',
    'a: 1\na: 2',
    'a: "unterminated',
    '  a: 1',
    'just text',
    'a: [x',
  ]) {
    assert.equal(code(() => yaml.parse(bad)), 'bad-yaml', bad);
  }
});

test('yaml: frontmatter split and join', () => {
  const md = '---\nid: x\nstatus: draft\n---\n# Title\n\nBody\n';
  const { data, body } = yaml.splitFrontmatter(md);
  assert.deepEqual(data, { id: 'x', status: 'draft' });
  assert.equal(body, '# Title\n\nBody\n');
  assert.equal(yaml.joinFrontmatter(data, body), md);
  assert.deepEqual(yaml.splitFrontmatter('# no frontmatter\n'), { data: null, body: '# no frontmatter\n' });
});

// ---------- ids ----------

test('ids: today is local YYYYMMDD', () => {
  assert.equal(ids.today(new Date(2026, 0, 5, 23, 59)), '20260105');
});

test('ids: slugify transliterates Polish and other letters', () => {
  assert.equal(ids.slugify('Miejsca spotkań klubu'), 'miejsca-spotkan-klubu');
  assert.equal(ids.slugify('Żółć, łódź & gęś!'), 'zolc-lodz-ges');
  assert.equal(ids.slugify('  Straße / Ærø  '), 'strasse-aero');
  assert.equal(ids.slugify('fix; rm -rf ~ $(x)'), 'fix-rm-rf-x');
});

test('ids: long slugs are cut at a word boundary', () => {
  assert.equal(ids.slugify('Heatmapa aktywności gracza w stylu GitHuba – siatka dni'), 'heatmapa-aktywnosci-gracza-w-stylu');
  assert.equal(ids.slugify('aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii'), 'aaaa-bbbb-cccc-dddd-eeee-ffff-gggg-hhhh');
  assert.equal(ids.slugify('aaaa bbbb cccc dddd eeee ffff gggg hhh iiii'), 'aaaa-bbbb-cccc-dddd-eeee-ffff-gggg-hhh', 'exactly 40 + word end');
});

test('ids: slug length limit and empty slug', () => {
  const s = ids.slugify('a'.repeat(30) + ' ' + 'b'.repeat(30));
  assert.ok(s.length <= ids.SLUG_MAX);
  assert.ok(!s.endsWith('-'));
  assert.equal(code(() => ids.slugify('!!! ???')), 'bad-slug');
});

test('ids: makeId adds a suffix on collision; validation', () => {
  assert.equal(ids.makeId('20261119', 'x'), '20261119-x');
  assert.equal(ids.makeId('20261119', 'x', ['20261119-x']), '20261119-x-2');
  assert.equal(ids.makeId('20261119', 'x', ['20261119-x', '20261119-x-2']), '20261119-x-3');
  assert.equal(ids.isValidId('20261119-club-meetings'), true);
  for (const bad of ['2026111-x', '20261119-', '20261119-X', '20261119-a--b', '20261119-../x', '20261119-a b', 'x']) {
    assert.equal(ids.isValidId(bad), false, bad);
  }
});

// ---------- semver ----------

test('semver: bump', () => {
  assert.equal(semver.bump('0.6.4', 'minor'), '0.7.0');
  assert.equal(semver.bump('0.6.4', 'bugfix'), '0.6.5');
  assert.equal(semver.bump('0.6.4', 'major'), '1.0.0');
  assert.equal(semver.bump('0.0.0', 'minor'), '0.1.0');
  assert.equal(code(() => semver.bump('0.6.4', 'patch')), 'bad-change-kind');
});

test('semver: parse, compare, validation', () => {
  assert.ok(semver.compare('0.10.0', '0.9.9') > 0);
  assert.equal(semver.compare('1.2.3', '1.2.3'), 0);
  for (const bad of ['1.2', '01.2.3', '1.2.3-beta', 'v1.2.3', '']) {
    assert.equal(semver.isValid(bad), false, bad);
    assert.equal(code(() => semver.parse(bad)), 'bad-version', bad);
  }
});
