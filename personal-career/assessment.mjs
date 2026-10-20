import { check, blocked, keys, string, array, oneOf, timestamp, safeId, version, validateSettings } from './contracts.mjs';
import { contentHash, writeJson, readJson, withLock } from './runtime.mjs';
import { validateSnapshot, profileHash, effectiveClaims } from './snapshot.mjs';
import { existsSync } from 'node:fs';
import { boundedPath } from './runtime.mjs';
import { postingKey } from '../url-key.mjs';
import { parseReport, isJdPointer, writeReportSection } from './report.mjs';

// Fit bands are fixed views of the upstream 1-5 global score (modes/_shared.md).
export const FIT_BANDS = [['Strong', 4.0], ['Moderate', 3.5], ['Stretch', 0]];
export const fitBand = score => FIT_BANDS.find(([, min]) => score >= min)[0];
const reportKey = n => String(parseInt(n, 10)).padStart(3, '0');

const pageKey = id => /^[0-9a-f-]{32,36}$/i.test(id) ? id.replaceAll('-','').toLowerCase() : id;
function bindings(rt) { return existsSync(boundedPath(rt.stateRoot,'identity-bindings.json')) ? readJson(rt,'identity-bindings.json') : []; }
export function bindIdentity(job, verification, rt) {
  validateJob(job); safeId(job.id);
  blocked(verification.state === 'verified' && verification.pageId, 'Identity adoption requires verified Notion readback');
  return withLock(rt,'identity-bindings',()=>{
    const all=bindings(rt), pageId=pageKey(verification.pageId);
    const prior=all.find(b=>b.jobId===job.id || b.pageId===pageId);
    blocked(!prior || (prior.jobId===job.id && prior.pageId===pageId), 'Conflicting identity binding');
    const binding={jobId:job.id,pageId,url:job.url,...(job.namespace?{namespace:job.namespace}:{}),...(job.requisitionId?{requisitionId:job.requisitionId}:{})};
    if(!prior) all.push(binding);
    writeJson(rt,'identity-bindings.json',all);return binding;
  });
}

export function canonicalUrl(value) {
  let u; try { u = new URL(value); } catch { check(false, 'Invalid job URL'); }
  check(['https:', 'http:'].includes(u.protocol) && !u.username && !u.password, 'Invalid job URL protocol or credentials');
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k) || ['gclid','fbclid','msclkid'].includes(k.toLowerCase())) u.searchParams.delete(k);
  u.searchParams.sort();
  return u.href;
}
function identityKeys(job) {
  const result = [];
  if (job.pageId) result.push(`notion:${pageKey(job.pageId)}`);
  if (job.namespace && job.requisitionId) result.push(`ats:${job.namespace}:${job.requisitionId}`);
  if (job.reportNumber) result.push(`report:${reportKey(job.reportNumber)}`);
  // Upstream's tracker key: aggregator posting IDs and known hash routes collapse
  // to one key, so the Notion index and merge-tracker agree on what a vacancy is.
  const url = job.url || job.canonicalUrl;
  // postingKey reads the raw URL: canonicalUrl drops the fragment, which would
  // erase a `#/job/{id}` route and merge two different postings.
  if (url) { canonicalUrl(url); result.push(`url:${postingKey(url)}`); }
  return result;
}
export function resolveIdentity(job, index, aliases = []) {
  const candidates = [...new Set([...identityKeys(job), ...aliases])];
  if (!candidates.length) return { kind: 'insufficient', reason: 'No stable identity' };
  const matches = (index.records ?? []).filter(r => identityKeys(r).some(k => candidates.includes(k)));
  const ids = [...new Set(matches.map(r => r.pageId ? pageKey(r.pageId) : null).filter(Boolean))];
  if (ids.length > 1) return { kind: 'ambiguous', pageIds: ids };
  if (ids.length === 1) {
    const boundIds=[...new Set(matches.map(r=>r.jobId).filter(Boolean))];
    if(boundIds.length>1) return {kind:'ambiguous',pageIds:ids,reason:'Conflicting persistent job IDs'};
    return { kind: 'matched', pageId: ids[0], id: boundIds[0] ? safeId(boundIds[0]) : `job-${contentHash(`notion:${ids[0]}`).slice(0,24)}` };
  }
  if (!index.complete) return { kind: 'insufficient', reason: 'Identity index incomplete' };
  return { kind: 'create', identityKey: candidates[0], id: `job-${contentHash(candidates[0]).slice(0,24)}` };
}
export function evaluateEligibility(job, settings) {
  validateSettings(settings);
  const f = job.facts ?? {}, blockers = [], unknowns = [];
  const salary = f.baseGBP;
  if (!salary || (!Number.isFinite(salary.min) && !Number.isFinite(salary.max))) unknowns.push('annual_base_salary');
  else if (Number.isFinite(salary.max) && salary.max < settings.compensation.minimumBaseGBP) blockers.push('base_below_minimum');
  else if (!Number.isFinite(salary.min) || salary.min < settings.compensation.minimumBaseGBP) unknowns.push('base_floor_offer_required');
  if (settings.sponsorship.required) {
    if (f.sponsorship === 'not_available') blockers.push('sponsorship_unavailable');
    else if (f.sponsorship !== 'confirmed') unknowns.push('sponsorship');
  }
  if (!(settings.location.london && f.london === true) && !(settings.location.ukRemoteFromLondon && f.ukRemoteFromLondon === true)) {
    if (f.london === false && f.ukRemoteFromLondon === false) blockers.push('location_outside_preferences');
    else unknowns.push('location');
  }
  return { status: blockers.length ? 'blocked' : unknowns.length ? 'verify' : 'eligible', blockers, unknowns };
}
export function validateJob(job) {
  keys(job, ['company','title','url','canonicalUrl','pageId','namespace','requisitionId','reportNumber','reportPath','jdText','jdHash','checkedAt','facts','id','identity','sourceNotes'], 'job');
  if (job.reportNumber !== undefined) check(/^\d{1,4}$/.test(String(job.reportNumber)), 'job report number');
  if (job.reportPath !== undefined) check(/^reports\/\d{3,4}-[^/]+\.md$/.test(job.reportPath), 'job report path');
  for (const k of ['company','title','url','jdText']) string(job[k], `job.${k}`);
  canonicalUrl(job.url); timestamp(job.checkedAt, 'job checked time');
  keys(job.facts, ['baseGBP','bonusGBP','sponsorship','london','ukRemoteFromLondon','workModel','attendance','travel','roleFamilies'], 'job facts');
  oneOf(job.facts.sponsorship, ['confirmed','conditional','unknown','not_available'], 'sponsorship');
  for (const k of ['london','ukRemoteFromLondon']) check([true,false,null].includes(job.facts[k]), `job location ${k}`);
  if (job.facts.baseGBP !== null) {
    keys(job.facts.baseGBP, ['min','max'], 'annual GBP base');
    const { min, max } = job.facts.baseGBP;
    for (const v of [min,max]) check(v === null || Number.isFinite(v) && v >= 0, 'annual GBP base range');
    if (min !== null && max !== null) check(min <= max, 'annual GBP base range order');
  }
  if (job.jdHash) check(job.jdHash === contentHash(job.jdText), 'JD hash mismatch');
  return job;
}
export function ingestRun(snapshot, jobs, rt, { settings, brief, limitations = [] }) {
  validateSnapshot(snapshot); validateSettings(settings); string(brief, 'Required profile brief');
  blocked(snapshot.sources.every(s => s.completeness === 'complete'), 'Assessment requires complete profile sources');
  safeId(snapshot.runId); array(jobs, 'jobs'); array(limitations, 'coverage limitations');
  const allBindings=bindings(rt);
  const index = { complete: snapshot.identityIndexComplete, records: snapshot.records.map(r=>{
    const binding=allBindings.find(b=>b.pageId===pageKey(r.pageId));
    return binding?{...binding,...r,jobId:binding.jobId}:r;
  }) };
  const groups=[];
  for(const job of jobs) {
    validateJob(job);
    const jobKeys=new Set(identityKeys(job));
    const matching=groups.filter(g=>g.keys.some(k=>jobKeys.has(k)));
    for(const group of matching) {
      blocked(contentHash(group.job.jdText)===contentHash(job.jdText) && contentHash(group.job.facts)===contentHash(job.facts), 'Conflicting representations of the same vacancy; choose current evidence');
      group.keys.forEach(k=>jobKeys.add(k));
    }
    const candidates=[job,...matching.map(g=>g.job)];
    const rank=j=>(j.pageId?4:0)+(j.namespace&&j.requisitionId?2:0);
    candidates.sort((a,b)=>rank(b)-rank(a));
    const merged=candidates[0];
    for(const group of matching) groups.splice(groups.indexOf(group),1);
    groups.push({job:merged,keys:[...jobKeys]});
  }
  const normalized = groups.map(({job:j,keys:aliases}) => {
    const identity = resolveIdentity(j, index, aliases);
    blocked(['matched','create'].includes(identity.kind), `Vacancy identity ${identity.kind}`);
    return { ...j, id: identity.id, identity, canonicalUrl: canonicalUrl(j.url), jdHash: contentHash(j.jdText) };
  });
  check(new Set(normalized.map(j => j.id)).size === normalized.length, 'Duplicate vacancy in run');
  const run = { version: 1, runId: snapshot.runId, snapshot, settings, brief, limitations, profileHash: profileHash(snapshot, settings), jobs: normalized };
  return withLock(rt, snapshot.runId, () => {
    writeJson(rt, `runs/${snapshot.runId}/run.json`, run, { immutable: true });
    return run;
  });
}
export function validateAssessment(a, { snapshot, job, settings }) {
  keys(a, ['version','jobId','snapshotHash','jdHash','eligibility','score','confidence','fit','reportPath','dimensions','rationale','matches','gaps','positioning'], 'assessment');
  version(a); check(a.jobId === job.id, 'Assessment job mismatch');
  check(Number.isFinite(a.score) && a.score >= 1 && a.score <= 5, 'Assessment needs the report 1-5 global score');
  oneOf(a.confidence, ['High','Medium','Low'], 'evidence confidence');
  string(a.reportPath, 'report path'); check(/^reports\/\d{3,4}-[^/]+\.md$/.test(a.reportPath), 'report path must be reports/NNN-*.md');
  check(a.snapshotHash === profileHash(snapshot, settings) && a.jdHash === job.jdHash, 'Assessment hash mismatch');
  check(contentHash(a.eligibility) === contentHash(evaluateEligibility(job, settings)), 'Eligibility differs from policy');
  oneOf(a.fit, FIT_BANDS.map(([b]) => b), 'fit');
  check(a.fit === fitBand(a.score), `Fit band must be ${fitBand(a.score)} for score ${a.score}`);
  keys(a.dimensions, ['skills','seniority','compensation','sponsorship','workLifeBalance','employer','location'], 'dimensions');
  Object.values(a.dimensions).forEach(v => string(v, 'dimension'));
  string(a.rationale, 'rationale'); string(a.positioning, 'positioning');
  array(a.matches, 'matches'); array(a.gaps, 'gaps');
  const claims = new Set(effectiveClaims(snapshot).map(c => c.id));
  for (const m of a.matches) {
    keys(m, ['claimId','jdEvidence','explanation'], 'match');
    check(claims.has(m.claimId), 'Unknown claim in assessment'); string(m.jdEvidence, 'JD evidence');
    check(job.jdText.includes(m.jdEvidence), 'JD evidence not found'); string(m.explanation, 'match explanation');
  }
  for (const g of a.gaps) { keys(g, ['detail','sourceUrl'], 'gap'); string(g.detail, 'gap detail'); canonicalUrl(g.sourceUrl); }
  return a;
}
export function saveAssessments(runId, assessments, rt) {
  safeId(runId);
  return withLock(rt, runId, () => {
    const run = readJson(rt, `runs/${runId}/run.json`);
    array(assessments, 'assessments');
    check(new Set(assessments.map(a => a.jobId)).size === assessments.length, 'Duplicate assessment');
    check(new Set(assessments.map(a => a.reportPath)).size === assessments.length, 'Two assessments share one report');
    const pairs = assessments.map(a => {
      const job = run.jobs.find(j => j.id === a.jobId); check(job, 'Unknown job');
      validateAssessment(a, { snapshot: run.snapshot, job, settings: run.settings });
      // The upstream report is the primary artifact: the assessment must agree with it.
      check(job.reportPath === a.reportPath, 'Assessment report differs from the job report (ingest the job from report-job)');
      const report = parseReport(rt, a.reportPath);
      check(report.score === a.score, `Assessment score ${a.score} differs from report ${report.score}/5`);
      check(!report.confidence || report.confidence === a.confidence, 'Assessment confidence differs from report Machine Summary');
      check(report.jdText, 'Report has no archived JD section');
      blocked(!isJdPointer(report.jdText), 'Report points to a jds/ capture; archive the JD text verbatim in the report so evidence can be checked');
      check(contentHash(report.jdText) === job.jdHash, 'Report archived JD differs from the ingested JD');
      return { a, job };
    });
    const ranked = [...assessments].sort((x, y) => y.score - x.score);
    const shortlist = { version: 1, runId, profileHash: run.profileHash, limitations: run.limitations,
      assessments, shortlistedIds: ranked.filter(a => a.eligibility.status !== 'blocked').slice(0, run.settings.shortlistLimit).map(a => a.jobId) };
    writeJson(rt, `runs/${runId}/assessments.json`, shortlist, { immutable: true });
    const reports = pairs.map(({ a, job }) => writeReportSection(rt, a.reportPath, a, job));
    return { ...shortlist, reports };
  });
}
