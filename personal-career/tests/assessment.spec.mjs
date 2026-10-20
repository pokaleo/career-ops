import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRuntime, contentHash } from '../runtime.mjs';
import { canonicalUrl, resolveIdentity, evaluateEligibility, ingestRun, saveAssessments } from '../assessment.mjs';
import { snapshotFixture, settingsFixture, temporaryRoots } from './fixtures.mjs';

import { jobFixture, assessmentFixture } from './job-fixtures.mjs';

test('identity preserves job identifiers and path case, removes tracking, and never matches by title', () => {
  assert.equal(canonicalUrl('https://example.invalid/Jobs?id=1&utm_source=x#top'), 'https://example.invalid/Jobs?id=1');
  assert.notEqual(canonicalUrl('https://example.invalid/jobs?id=1'), canonicalUrl('https://example.invalid/jobs?id=2'));
  const index = { complete: true, records: [{ pageId: 'page-a', canonicalUrl: 'https://example.invalid/jobs?id=123', namespace: 'example-ats', requisitionId: '123' }] };
  assert.equal(resolveIdentity(jobFixture(), index).pageId, 'page-a');
  assert.equal(resolveIdentity(jobFixture({ requisitionId: '456', url: 'https://example.invalid/jobs?id=456' }), index).kind, 'create');
  index.records.push({ ...index.records[0], pageId: 'page-b' });
  assert.equal(resolveIdentity(jobFixture(), index).kind, 'ambiguous');
  assert.equal(resolveIdentity(jobFixture(), { complete: false, records: [] }).kind, 'insufficient');
  assert.equal(resolveIdentity({ company: 'Example Ltd', title: 'AI Engineer' }, { complete: true, records: [] }).kind, 'insufficient');
});
test('eligibility uses annual base, includes unknowns and all role families, and honors explicit refusal', () => {
  const s = settingsFixture(), j = jobFixture();
  assert.equal(evaluateEligibility(j, s).status, 'eligible');
  j.facts.baseGBP = { min: 60000, max: 69000 }; j.facts.bonusGBP = 50000;
  assert.equal(evaluateEligibility(j, s).status, 'blocked');
  j.facts.baseGBP = { min: 65000, max: 85000 };
  assert.equal(evaluateEligibility(j, s).status, 'verify');
  j.facts.baseGBP = null; j.facts.sponsorship = 'unknown';
  assert.deepEqual(evaluateEligibility(j, s).unknowns, ['annual_base_salary', 'sponsorship']);
  j.facts.sponsorship = 'not_available';
  assert.equal(evaluateEligibility(j, s).status, 'blocked');
  for (const title of ['Applied AI Engineer','AI Product Engineer','Forward Deployed Engineer','Architect','Backend Engineer']) {
    assert.equal(evaluateEligibility(jobFixture({ title }), s).status, 'eligible');
  }
});
test('assessment writes only immutable run state and rejects draft content and invented hashes', t => {
  const rt = resolveRuntime(temporaryRoots(t));
  mkdirSync(join(rt.dataRoot, 'data'), { recursive: true });
  for (const name of ['applications.md','star-stories.json']) writeFileSync(join(rt.dataRoot, 'data', name), 'untouched');
  const run = ingestRun(snapshotFixture(), [jobFixture()], rt, { settings: settingsFixture(), brief: 'Fictional verified profile' });
  const assessment = assessmentFixture(run, rt.dataRoot);
  assert.throws(() => saveAssessments(run.runId, [{ ...assessment, cv: 'unauthorized draft' }], rt), /unknown/i);
  assert.throws(() => saveAssessments(run.runId, [{ ...assessment, snapshotHash: contentHash('wrong') }], rt), /hash/i);
  const result = saveAssessments(run.runId, [assessment], rt);
  assert.equal(result.assessments.length, 1);
  assert.throws(() => saveAssessments(run.runId, [{ ...assessment, rationale: 'Changed result' }], rt), /immutable/i);
  for (const name of ['applications.md','star-stories.json']) assert.equal(readFileSync(join(rt.dataRoot, 'data', name), 'utf8'), 'untouched');
  assert.equal(existsSync(join(rt.dataRoot, 'output')), false);
  assert.throws(() => ingestRun(snapshotFixture(), [jobFixture()], rt, { settings: settingsFixture(), brief: '' }), /brief/i);
});
test('mixed ATS and URL representations of the same incoming vacancy deduplicate', t => {
  const rt=resolveRuntime(temporaryRoots(t)),rich=jobFixture(),urlOnly=jobFixture({namespace:undefined,requisitionId:undefined});
  delete urlOnly.namespace;delete urlOnly.requisitionId;
  const run=ingestRun(snapshotFixture(),[urlOnly,rich],rt,{settings:settingsFixture(),brief:'profile'});
  assert.equal(run.jobs.length,1);assert.equal(run.jobs[0].requisitionId,'123');
  const s=snapshotFixture();s.runId='conflicting-copy';
  assert.throws(()=>ingestRun(s,[rich,{...urlOnly,jdText:'Changed requirements'}],rt,{settings:settingsFixture(),brief:'profile'}),/conflict/i);
});
