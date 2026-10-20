import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { resolveRuntime, contentHash } from '../runtime.mjs';
import { ingestRun, saveAssessments, resolveIdentity, fitBand } from '../assessment.mjs';
import { readFileSync as readRaw } from 'node:fs';
import { parseReport, attachSection, SECTION_START } from '../report.mjs';
import { planMirror, mirrorTracker, STAGE_TO_STATE } from '../tracker-mirror.mjs';
import { syncStatus, recordPush, profilePropose, profileAccept } from '../sync.mjs';
import { planUpdate, journalOperation } from '../notion-plan.mjs';
import { jobFixture, assessmentFixture, reportFixture, REPORT_PATH } from './job-fixtures.mjs';
import { temporaryRoots, snapshotFixture, settingsFixture } from './fixtures.mjs';

const realRuntime = t => resolveRuntime({ dataRoot: temporaryRoots(t).dataRoot });

test('fit band is a fixed view of the upstream 1-5 score', () => {
  assert.equal(fitBand(4.0), 'Strong'); assert.equal(fitBand(3.9), 'Moderate');
  assert.equal(fitBand(3.5), 'Moderate'); assert.equal(fitBand(3.4), 'Stretch');
});

test('assessment must agree with its upstream report, and the report gains the personal section', t => {
  const rt = resolveRuntime(temporaryRoots(t)), settings = settingsFixture();
  const run = ingestRun(snapshotFixture(), [jobFixture()], rt, { settings, brief: 'Profile evidence' });
  const a = assessmentFixture(run, rt.dataRoot);
  assert.throws(() => saveAssessments(run.runId, [{ ...a, score: 4.2, fit: 'Strong' }], rt), /differs from report/);
  assert.throws(() => saveAssessments(run.runId, [{ ...a, fit: 'Strong' }], rt), /Fit band must be Moderate/);
  reportFixture(rt.dataRoot, { ...run.jobs[0], jdText: 'A different posting.' });
  assert.throws(() => saveAssessments(run.runId, [a], rt), /archived JD differs/);
  writeFileSync(join(rt.dataRoot, REPORT_PATH), readRaw(join(rt.dataRoot, REPORT_PATH), 'utf8').replace('A different posting.', 'See jds/001-x.pdf for the full archive (archive-posting.mjs --report=1).'));
  assert.throws(() => saveAssessments(run.runId, [a], rt), /jds\/ capture/);
  assert.throws(() => saveAssessments(run.runId, [{ ...a, reportPath: 'reports/002-other-2026-10-20.md' }], rt), /differs from the job report/);
  assert.throws(() => saveAssessments(run.runId, [a, { ...a, jobId: 'job-other' }], rt), /share one report/);
  reportFixture(rt.dataRoot, run.jobs[0]);
  const saved = saveAssessments(run.runId, [a], rt);
  const md = readFileSync(join(rt.dataRoot, REPORT_PATH), 'utf8');
  assert.equal(saved.reports[0].hash, contentHash(md));
  assert.ok(md.indexOf(SECTION_START) < md.indexOf('## Job Description (archived verbatim)'), 'section sits before the archived JD');
  assert.match(md, /\*\*Fit:\*\* Moderate \(3\.7\/5, Medium confidence\)/);
  assert.equal(parseReport(rt, REPORT_PATH).jdText, run.jobs[0].jdText, 'the inserted section does not leak into the archived JD');
  const again = attachSection(md, `${SECTION_START}\nreplaced\n<!-- personal-career:end -->`);
  assert.equal(again.split(SECTION_START).length, 2, 're-attaching replaces, never duplicates');
});

test('identity uses upstream posting keys: aggregator id spellings collapse, report numbers bind', () => {
  const index = { complete: true, records: [{ pageId: 'aaaa1111bbbb2222cccc3333dddd4444', url: 'https://www.linkedin.com/jobs/view/4001' }] };
  const viaSearch = resolveIdentity({ url: 'https://www.linkedin.com/jobs/search/?currentJobId=4001' }, index);
  assert.equal(viaSearch.kind, 'matched');
  const hashIndex = { complete: true, records: [{ pageId: 'p-111', url: 'https://acme.invalid/careers#/job/111' }] };
  assert.equal(resolveIdentity({ url: 'https://acme.invalid/careers#/job/222' }, hashIndex).kind, 'create', 'different hash-route ids stay different vacancies');
  assert.equal(resolveIdentity({ url: 'https://acme.invalid/careers#/job/111' }, hashIndex).kind, 'matched');
  const byReport = resolveIdentity({ reportNumber: '7' }, { complete: true, records: [{ pageId: 'p-7', reportNumber: '007' }] });
  assert.equal(byReport.kind, 'matched');
});

test('Notion stages map onto canonical upstream states; mirror plans additions and status changes', () => {
  const states = readFileSync(new URL('../../templates/states.yml', import.meta.url), 'utf8');
  for (const s of new Set(Object.values(STAGE_TO_STATE))) assert.match(states, new RegExp(`\\b${s}\\b`), `${s} is canonical`);
  const rows = [{ num: 3, status: 'Evaluated', notes: 'notion:aaaa', report: '—', url: '' }];
  const plan = planMirror([
    { pageId: 'aaaa', company: 'A', position: 'R', stage: 'Applied' },
    { pageId: 'bbbb', company: 'B', position: 'R', stage: 'Wishlist', url: 'https://jobs.example.invalid/9' },
  ], rows);
  assert.deepEqual(plan.updates.map(u => [u.row, u.state]), [[3, 'Applied']]);
  assert.equal(plan.additions[0].state, 'Evaluated');
  const bad = planMirror([{ pageId: 'c', company: 'C', position: 'R', stage: 'Mystery' }, { pageId: 'd', company: '', position: 'R', stage: 'Applied' }], []);
  assert.deepEqual(bad.invalid.map(i => i.pageId), ['c', 'd']);
  assert.match(bad.invalid[0].error, /Unmapped Notion stage/);
});

test('mirror writes through merge-tracker and set-status, and is idempotent', t => {
  const rt = realRuntime(t);
  const records = [{ pageId: 'aaaa1111bbbb2222cccc3333dddd4444', company: 'Example Ltd', position: 'AI Engineer', stage: 'Wishlist', url: 'https://jobs.example.invalid/1', score: 3.7 }];
  const first = mirrorTracker({ records, apply: true, today: '2026-10-20' }, rt);
  assert.equal(first.results[0].added, 1);
  records[0].stage = 'Technical Interview';
  assert.deepEqual(mirrorTracker({ records, apply: true }, rt).results, [{ pageId: records[0].pageId, updated: 1, state: 'Interview' }]);
  assert.equal(mirrorTracker({ records, apply: true }, rt).unchanged.length, 1);
  assert.match(readFileSync(join(rt.dataRoot, 'data', 'applications.md'), 'utf8'), /\| 1 \| 2026-10-20 \| Example Ltd \| AI Engineer \| 3\.7\/5 \| Interview \|/);
});

test('a failed merge removes its TSVs and releases its numbers, so a re-run starts clean', t => {
  const rt = realRuntime(t);
  const records = [{ pageId: 'aaaa1111bbbb2222cccc3333dddd4444', company: 'Example Ltd', position: 'AI Engineer', stage: 'Wishlist' }];
  const calls = [];
  const failingMerge = (cmd, args, opts) => {
    calls.push(args[0].split('/').pop());
    if (args[0].endsWith('merge-tracker.mjs')) return { status: 1, stderr: 'simulated merge failure' };
    return spawnSync(cmd, args, opts);
  };
  assert.throws(() => mirrorTracker({ records, apply: true }, rt, failingMerge), /merge-tracker\.mjs failed/);
  assert.deepEqual(calls, ['reserve-report-num.mjs', 'merge-tracker.mjs', 'reserve-report-num.mjs']);
  const dir = join(rt.dataRoot, 'batch', 'tracker-additions');
  assert.deepEqual(existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.tsv')) : [], []);
  assert.equal(mirrorTracker({ records, apply: true }, rt).results[0].added, 1, 're-run succeeds');
});

test('sync ledger lists unpushed artifacts and records only verified pushes', t => {
  const rt = realRuntime(t);
  reportFixture(rt.dataRoot, jobFixture());
  mkdirSync(join(rt.dataRoot, 'interview-prep', 'sessions'), { recursive: true });
  writeFileSync(join(rt.dataRoot, 'interview-prep', 'sessions', '2026-10-21-example.md'), 'Fictional session');
  writeFileSync(join(rt.dataRoot, 'interview-prep', 'question-bank.md'), 'not synced');
  const status = syncStatus(rt);
  assert.deepEqual(status.pending.map(p => [p.path, p.kind]), [
    ['interview-prep/sessions/2026-10-21-example.md', 'interview'], [REPORT_PATH, 'report']]);
  const ownership = { properties: [], sections: ['career-workflow'] };
  const page = { pageId: 'page-1', schemaHash: 's', properties: {}, sections: { 'career-workflow': null } };
  const hash = status.pending.find(p => p.path === REPORT_PATH).hash;
  const plan = planUpdate(page, structuredClone(page), { operationId: 'op-1', kind: 'sync', identity: 'job-1', artifact: { path: REPORT_PATH, hash }, sections: { 'career-workflow': 'report body' } }, ownership);
  journalOperation(plan, rt);
  const sessionPath = 'interview-prep/sessions/2026-10-21-example.md';
  const sessionHash = status.pending.find(p => p.path === sessionPath).hash;
  assert.throws(() => recordPush({ path: sessionPath, operationId: 'op-1', hash: sessionHash, observations: [] }, rt), /did not push this file/, 'an operation only marks its own file');
  const synced = { ...page, sections: { 'career-workflow': 'report body' } };
  const noop = planUpdate(synced, structuredClone(synced), { operationId: 'op-2', kind: 'sync', identity: 'job-1', artifact: { path: REPORT_PATH, hash }, sections: { 'career-workflow': 'report body' } }, ownership);
  journalOperation(noop, rt);
  assert.throws(() => recordPush({ path: REPORT_PATH, operationId: 'op-2', hash, observations: [] }, rt), /Readback/, 'a no-op still needs a readback');
  const push = { path: REPORT_PATH, operationId: 'op-1', hash };
  assert.throws(() => recordPush({ ...push, observations: [] }, rt), /verified/, 'no readback, no record');
  assert.throws(() => recordPush({ ...push, reconciliation: { state: 'verified' }, observations: [] }, rt), /unknown field|verified/, 'a claimed verification is not accepted');
  const readback = [{ pageId: 'page-1', properties: {}, sections: { 'career-workflow': 'report body' } }];
  recordPush({ ...push, observations: readback }, rt);
  assert.equal(syncStatus(rt).pending.length, 1);
  writeFileSync(join(rt.dataRoot, REPORT_PATH), 'edited locally');
  assert.equal(syncStatus(rt).pending.find(p => p.path === REPORT_PATH).reason, 'changed');
});

test('Notion pull is staged as a diff and applied only after confirmation, with a backup', t => {
  const rt = realRuntime(t);
  writeFileSync(join(rt.dataRoot, 'cv.md'), '# Old\n\n## Experience\n\n### Old Co — London\n');
  const source = { id: 'notion-cv', retrievedAt: '2026-10-20T12:00:00Z' };
  assert.throws(() => profilePropose({ files: { 'cv.md': '# Flat list\n- claim' }, sources: [source] }, rt), /Experience/);
  assert.throws(() => profilePropose({ files: { 'modes/_custom.md': 'x' }, sources: [source] }, rt), /unknown field/);
  const cv = '# Example\n\n## Experience\n\n### Example Ltd — London\n**AI Engineer**\n2024 – present\n';
  const staged = profilePropose({ files: { 'cv.md': cv }, sources: [source] }, rt);
  assert.match(staged.diffs['cv.md'], /\+### Example Ltd — London/);
  assert.match(readFileSync(join(rt.dataRoot, 'cv.md'), 'utf8'), /Old Co/, 'nothing changes before accept');
  assert.throws(() => profileAccept({ pullId: staged.pullId, requestRef: '' }, rt), /confirmation/);
  profileAccept({ pullId: staged.pullId, requestRef: 'user:confirmed-cv-diff' }, rt);
  assert.equal(readFileSync(join(rt.dataRoot, 'cv.md'), 'utf8'), cv);
  assert.ok(existsSync(join(rt.stateRoot, 'pulls', staged.pullId, 'backup', 'cv.md')));
  assert.equal(syncStatus(rt).pending.some(p => p.path === 'cv.md'), false, 'a pulled file counts as synced');
  assert.throws(() => profileAccept({ pullId: staged.pullId, requestRef: 'user:again' }, rt), /already accepted/);
  const next = profilePropose({ files: { 'cv.md': cv.replace('present', '2026') }, sources: [source] }, rt);
  writeFileSync(join(rt.dataRoot, 'cv.md'), cv + '\nlocal edit\n');
  assert.throws(() => profileAccept({ pullId: next.pullId, requestRef: 'user:ok' }, rt), /changed locally/);
});

test('Notion plans can own several page sections without touching human content', () => {
  const ownership = { properties: ['Stage'], sections: ['career-workflow', 'career-workflow-interview'] };
  const base = { pageId: 'p', schemaHash: 's', properties: { Stage: 'Applied' }, sections: { 'career-workflow': 'old', 'career-workflow-interview': null } };
  const intent = { operationId: 'op', kind: 'sync', identity: 'job-1', artifact: { path: 'reports/001-x.md', hash: 'h' }, sections: { 'career-workflow': 'new report', 'career-workflow-interview': 'prep pack' } };
  const plan = planUpdate(base, structuredClone(base), intent, ownership);
  assert.deepEqual(plan.sections, { 'career-workflow': 'new report', 'career-workflow-interview': 'prep pack' });
  assert.deepEqual(plan.properties, {}, 'a sync intent never moves the stage');
  assert.deepEqual(Object.keys(plan.artifact.sectionHashes), ['career-workflow', 'career-workflow-interview']);
  assert.throws(() => planUpdate(base, base, { ...intent, artifact: undefined }, ownership), /sync artifact/);
  const edited = { ...structuredClone(base), sections: { ...base.sections, 'career-workflow': 'human edit' } };
  assert.deepEqual(planUpdate(base, edited, intent, ownership).conflicts, ['body:career-workflow']);
  assert.throws(() => planUpdate(base, base, { ...intent, sections: { Notes: 'x' } }, ownership), /not owned/);
});
