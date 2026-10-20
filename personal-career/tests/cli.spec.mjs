import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { temporaryRoots, snapshotFixture, settingsFixture } from './fixtures.mjs';
import { jobFixture, assessmentFixture } from './job-fixtures.mjs';
const cli = join(dirname(dirname(fileURLToPath(import.meta.url))), 'cli.mjs');
function invoke(command, data, cwd) {
  return spawnSync(process.execPath, [cli, command, '-'], { cwd, input: typeof data === 'string' ? data : JSON.stringify(data), encoding: 'utf8' });
}
test('CLI works from another CWD, diagnoses input, enforces selection and needs a brief', t => {
  const { root, dataRoot } = temporaryRoots(t);
  assert.equal(invoke('profile', { dataRoot, snapshot: snapshotFixture(), settings: settingsFixture() }, root).status, 0);
  assert.equal(invoke('profile', '{invalid', root).status, 2);
  const input = { dataRoot, snapshot: snapshotFixture(), settings: settingsFixture(), jobs: [jobFixture()], brief: 'verified profile' };
  assert.equal(invoke('ingest', { ...input, brief: '' }, root).status, 2);
  assert.equal(invoke('ingest', { ...input, snapshot: { ...input.snapshot, runId: '../escape' } }, root).status, 2);
  const ingested = invoke('ingest', input, root); assert.equal(ingested.status, 0, ingested.stderr);
  const run = JSON.parse(ingested.stdout), a = assessmentFixture(run, dataRoot);
  assert.equal(invoke('assess', { dataRoot, runId: run.runId, assessments: [a] }, root).status, 0);
  assert.equal(invoke('assess', { dataRoot, runId: run.runId, assessments: [{ ...a, rationale: 'Changed result' }] }, root).status, 3);
  assert.equal(invoke('assess', { dataRoot, runId: run.runId, assessments: [{ ...a, fit: 'Strong' }] }, root).status, 2);
  assert.equal(invoke('materials-check', { dataRoot, jobId: a.jobId, snapshotHash: a.snapshotHash, jdHash: a.jdHash }, root).status, 3);
});
test('private state and protected skill survive a simulated updater system-tree replacement', t => {
  const { repoRoot, dataRoot } = temporaryRoots(t);
  for (const dir of ['.agents','tests','personal-career']) mkdirSync(join(repoRoot, dir));
  writeFileSync(join(repoRoot, 'personal-career', 'SKILL.md'), 'protected');
  writeFileSync(join(dataRoot, 'private.json'), 'private');
  for (const dir of ['.agents','tests']) { rmSync(join(repoRoot, dir), { recursive: true }); mkdirSync(join(repoRoot, dir)); }
  assert.equal(readFileSync(join(repoRoot, 'personal-career', 'SKILL.md'), 'utf8'), 'protected');
  assert.equal(readFileSync(join(dataRoot, 'private.json'), 'utf8'), 'private');
});
test('CLI conflict plans and pending reconciliation return blocked status with machine-readable details', t => {
  const {root,dataRoot}=temporaryRoots(t);
  const base={pageId:'page',schemaHash:'s',properties:{Fit:'Moderate'},sections:{}};
  const response=invoke('plan-notion',{dataRoot,base,current:{...base,properties:{Fit:'Stretch'}},
    intent:{operationId:'op',identity:'job',kind:'assess',properties:{Fit:'Strong'}},ownership:{properties:['Fit'],section:'career-workflow'}},root);
  assert.equal(response.status,3);assert.deepEqual(JSON.parse(response.stdout).conflicts,['Fit']);
});
