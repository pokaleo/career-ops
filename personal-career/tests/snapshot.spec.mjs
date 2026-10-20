import test from 'node:test';
import assert from 'node:assert/strict';
import { symlinkSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRuntime, writeJson, readJson, contentHash, withLock } from '../runtime.mjs';
import { validateSnapshot, effectiveClaims, profileHash, projectProfile } from '../snapshot.mjs';
import { snapshotFixture, settingsFixture, temporaryRoots } from './fixtures.mjs';
import { validateProfile, EXAMPLE_PATH } from '../../validate-profile.mjs';

test('external root is independent of CWD; private data cannot enter checkout through symlinks', t => {
  const { repoRoot, dataRoot, root } = temporaryRoots(t);
  const rt = resolveRuntime({ repoRoot, dataRoot });
  assert.equal(rt.dataRoot, dataRoot);
  assert.equal(rt.stateRoot, join(dataRoot, 'data', 'personal-career'));
  assert.throws(() => resolveRuntime({ repoRoot, dataRoot: join(repoRoot, 'private') }), /git-ignored/i);
  symlinkSync(repoRoot, join(root, 'alias'), 'dir');
  assert.throws(() => resolveRuntime({ repoRoot, dataRoot: join(root, 'alias', 'private') }), /git-ignored/i);
});
test('in-checkout data root is accepted only when git ignores it', t => {
  const { repoRoot } = temporaryRoots(t);
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: repoRoot }).status, 0);
  assert.throws(() => resolveRuntime({ repoRoot, dataRoot: join(repoRoot, 'career-data') }), /git-ignored/i);
  writeFileSync(join(repoRoot, '.gitignore'), '/career-data/\n');
  const rt = resolveRuntime({ repoRoot, dataRoot: join(repoRoot, 'career-data') });
  assert.equal(rt.stateRoot, join(repoRoot, 'career-data', 'data', 'personal-career'));
  assert.throws(() => resolveRuntime({ repoRoot, dataRoot: repoRoot }), /subfolder/i);
  writeFileSync(join(repoRoot, '.gitignore'), 'cv.md\ncareer-data/data/\n');
  assert.throws(() => resolveRuntime({ repoRoot, dataRoot: join(repoRoot, 'career-data') }), /git-ignored/i);
});
test('existing upstream data-root resolver is used when no explicit root is supplied', () => {
  const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const prior = process.env.CAREER_OPS_DATA_DIR, priorRoot = process.env.CAREER_OPS_ROOT;
  delete process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_DATA_DIR = '../fictional-external-data';
  try {
    assert.equal(resolveRuntime({ repoRoot }).dataRoot, join(dirname(repoRoot), 'fictional-external-data'));
  } finally {
    if (prior === undefined) delete process.env.CAREER_OPS_DATA_DIR; else process.env.CAREER_OPS_DATA_DIR = prior;
    if (priorRoot === undefined) delete process.env.CAREER_OPS_ROOT; else process.env.CAREER_OPS_ROOT = priorRoot;
  }
});
test('runtime writes are bounded, atomic and immutable when requested', t => {
  const roots = temporaryRoots(t), rt = resolveRuntime(roots);
  writeJson(rt, 'runs/one.json', { count: 1 }, { immutable: true });
  assert.deepEqual(readJson(rt, 'runs/one.json'), { count: 1 });
  writeJson(rt, 'runs/one.json', { count: 1 }, { immutable: true });
  assert.throws(() => writeJson(rt, 'runs/one.json', { count: 2 }, { immutable: true }), /immutable/i);
  assert.throws(() => writeJson(rt, '../escape.json', {}), /path/i);
  mkdirSync(join(rt.stateRoot, 'links'));
  symlinkSync(roots.repoRoot, join(rt.stateRoot, 'links', 'escape'), 'dir');
  assert.throws(() => writeJson(rt, 'links/escape/leak.json', {}), /path/i);
  assert.equal(existsSync(join(roots.repoRoot, 'leak.json')), false);
});
test('writer lock refuses an overlapping run and releases after errors', t => {
  const rt = resolveRuntime(temporaryRoots(t));
  assert.throws(() => withLock(rt, 'run-1', () => withLock(rt, 'run-1', () => {})), /locked/i);
  assert.equal(withLock(rt, 'run-1', () => 42), 42);
});
test('snapshot validates provenance and preserves absent timestamps', () => {
  const snapshot = snapshotFixture();
  assert.deepEqual(validateSnapshot(snapshot), snapshot);
  assert.equal(validateSnapshot(snapshot).sources[0].sourceEditedAt, null);
  const dangling = structuredClone(snapshot); dangling.claims[0].sourceId = 'missing';
  assert.throws(() => validateSnapshot(dangling), /source/i);
  const tampered = structuredClone(snapshot); tampered.sources[0].content += 'tampered';
  assert.throws(() => validateSnapshot(tampered), /hash/i);
  assert.throws(() => validateSnapshot({ ...snapshot, version: 2 }), /version/i);
  assert.throws(() => validateSnapshot({ ...snapshot, surprise: true }), /unknown/i);
});
test('explicit corrections supersede older facts while a deferred disposition survives', () => {
  const snapshot = snapshotFixture();
  snapshot.claims.push({ ...snapshot.claims[0], id: 'new-notice', value: 'Six months notice',
    supersedes: ['notice'], writeDisposition: 'deferred' });
  const current = effectiveClaims(snapshot);
  assert.equal(current.some(c => c.id === 'notice'), false);
  assert.equal(current.find(c => c.id === 'new-notice').writeDisposition, 'deferred');
  snapshot.claims[0].supersedes = ['new-notice'];
  assert.throws(() => validateSnapshot(snapshot), /cycle/i);
});
test('material profile hash ignores retrieval metadata and application state, but tracks evidence', () => {
  const original = snapshotFixture(), refreshed = structuredClone(original);
  refreshed.runId = 'run-2'; refreshed.retrievedAt = '2026-10-21T12:00:00Z';
  refreshed.sources[0].retrievedAt = refreshed.retrievedAt;
  refreshed.records.push({ pageId: 'new-page', properties: { Stage: 'Applied' } });
  const settings = settingsFixture();
  assert.equal(profileHash(original, settings), profileHash(refreshed, settings));
  refreshed.claims[0].value = 'Six months notice';
  assert.notEqual(profileHash(original, settings), profileHash(refreshed, settings));
  assert.equal(contentHash({ b: 1, a: 2 }), contentHash({ a: 2, b: 1 }));
});
test('projection includes expected qualifiers, excludes unverified metrics, and requires complete sources', () => {
  const snapshot = snapshotFixture(), settings = settingsFixture();
  const projected = projectProfile(snapshot, settings);
  assert.match(projected.claimsMarkdown, /Three months notice/);
  assert.match(projected.claimsMarkdown, /expected/i);
  assert.doesNotMatch(projected.claimsMarkdown, /80%/);
  const profile = JSON.parse(projected.profileYaml);
  assert.equal(profile.location.needs_sponsorship, true);
  assert.deepEqual(profile.location.authorized_in, []);
  assert.match(projected.briefMarkdown, /^## Hard DQ Criteria/m);
  assert.doesNotMatch(projected.briefMarkdown, /\{[A-Z][^}]*\}/);
  snapshot.sources[0].completeness = 'partial';
  assert.throws(() => projectProfile(snapshot, settings), /complete/i);
});
test('projection is accepted by the actual upstream profile schema with supported identity and compensation', () => {
  const s=settingsFixture(),p=projectProfile(snapshotFixture(),s);
  const validation=validateProfile(p.profileYaml,readFileSync(EXAMPLE_PATH,'utf8'));
  assert.deepEqual(validation.findings,[]);
  assert.equal(validation.parsed.candidate.full_name,s.candidate.name);
  assert.equal(validation.parsed.candidate.title,s.candidate.headline);
  assert.equal(validation.parsed.compensation.minimum,'£70,000 annual base');
  assert.equal(validation.parsed.compensation.currency,'GBP');
  assert.match(validation.parsed.location.visa_status,/sponsorship required/i);
});
test('unrelated application correction claims neither stale selections nor enter CV projections', () => {
  const before=snapshotFixture(),after=structuredClone(before),settings=settingsFixture();
  after.claims.push({...after.claims[0],id:'other-rejected',key:'application:other-page:stage',value:'Rejected',writeDisposition:'deferred'});
  assert.equal(profileHash(before,settings),profileHash(after,settings));
  assert.doesNotMatch(projectProfile(after,settings).claimsMarkdown,/Rejected/);
});
