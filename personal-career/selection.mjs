import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { check, blocked, string, array, safeId } from './contracts.mjs';
import { readJson, writeJson, boundedPath, withLock } from './runtime.mjs';

const stateFile = 'selections/current.json';
function current(rt) { return existsSync(boundedPath(rt.stateRoot, stateFile)) ? readJson(rt, stateFile) : {}; }
export function recordSelection({ runId, jobIds, requestRef }, rt) {
  safeId(runId); string(requestRef, 'Explicit user request reference'); array(jobIds, 'Selected job IDs');
  check(jobIds.length > 0 && new Set(jobIds).size === jobIds.length, 'Select distinct job IDs');
  const run = readJson(rt, `runs/${runId}/run.json`), shortlist = readJson(rt, `runs/${runId}/assessments.json`);
  const jobs = jobIds.map(id => {
    safeId(id); const job = run.jobs.find(j => j.id === id), assessment = shortlist.assessments.find(a => a.jobId === id);
    check(job && assessment, 'Unknown or unassessed job ID');
    blocked(assessment.eligibility.status !== 'blocked', 'Eligibility blocked; update settings/evidence and reassess before selecting');
    return { jobId: id, snapshotHash: run.profileHash, jdHash: job.jdHash };
  });
  return withLock(rt, 'selections', () => {
    const selection = { version: 1, id: randomUUID(), runId, jobs, requestRef, createdAt: new Date().toISOString(), revoked: false };
    const state = current(rt);
    jobs.forEach(j => { state[j.jobId] = selection; });
    writeJson(rt, `selections/history/${selection.id}.json`, selection, { immutable: true });
    writeJson(rt, stateFile, state);
    return selection;
  });
}
export function requireSelection({ jobId, snapshotHash, jdHash }, rt) {
  safeId(jobId); string(snapshotHash, 'profile hash'); string(jdHash, 'JD hash');
  const selection = current(rt)[jobId];
  blocked(selection, 'Role has not been explicitly selected');
  blocked(!selection.revoked, 'Selection revoked');
  const job = selection.jobs.find(j => j.jobId === jobId);
  blocked(job && job.snapshotHash === snapshotHash && job.jdHash === jdHash, 'Selection stale; reassess changed evidence and obtain selection again');
  return selection;
}
export function revokeSelection({ jobIds, requestRef }, rt) {
  string(requestRef, 'Explicit user request reference'); array(jobIds, 'job IDs');
  return withLock(rt, 'selections', () => {
    const state = current(rt);
    jobIds.forEach(id => { safeId(id); check(state[id], 'Unknown selection'); });
    const revocation = { version: 1, id: randomUUID(), jobIds, requestRef, revokedAt: new Date().toISOString() };
    jobIds.forEach(id => { state[id] = { ...state[id], revoked: true, revocation }; });
    writeJson(rt, `selections/history/${revocation.id}.json`, revocation, { immutable: true });
    writeJson(rt, stateFile, state);
    return revocation;
  });
}
