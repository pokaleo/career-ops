import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateEligibility } from '../assessment.mjs';

export const REPORT_PATH = 'reports/001-example-2026-10-20.md';
/** A minimal upstream-shaped oferta report for the fixture job (fictional). */
export function reportFixture(dataRoot, job, { score = 3.7, confidence = 'medium', path = REPORT_PATH } = {}) {
  mkdirSync(join(dataRoot, 'reports'), { recursive: true });
  writeFileSync(join(dataRoot, path), `# Evaluation: ${job.company} — ${job.title}\n\n**Date:** 2026-10-20\n**URL:** ${job.url}\n`
    + `**Score:** ${score}/5\n**Decision:** Consider\n**Legitimacy:** High Confidence\n\nFictional verdict.\n\n---\n\n`
    + `## Machine Summary\n\n\`\`\`yaml\nscore: ${score}\nconfidence: ${confidence}\nfinal_decision: Consider\n\`\`\`\n\n`
    + `## A) Role Summary\n\nFictional.\n\n## Job Description (archived verbatim)\n\n${job.jdText}\n`);
  return path;
}

export function jobFixture(overrides = {}) {
  return { company: 'Example Ltd', title: 'AI Engineer', url: 'https://example.invalid/jobs?id=123&utm_source=mail',
    namespace: 'example-ats', requisitionId: '123', reportPath: REPORT_PATH, jdText: 'Build production software.',
    checkedAt: '2026-10-20T12:00:00Z', facts: { baseGBP: { min: 75000, max: 100000 },
      sponsorship: 'confirmed', london: true, ukRemoteFromLondon: false, workModel: 'hybrid' }, ...overrides };
}
/** Writes the matching report under `dataRoot` (when given) so saveAssessments can cross-check it. */
export function assessmentFixture(run, dataRoot, job = run.jobs[0]) {
  if (dataRoot) reportFixture(dataRoot, job);
  return { version: 1, jobId: job.id, snapshotHash: run.profileHash, jdHash: job.jdHash,
    eligibility: evaluateEligibility(job, run.settings), score: 3.7, confidence: 'Medium', fit: 'Moderate', reportPath: REPORT_PATH,
    dimensions: { skills: 'Relevant document workflow experience', seniority: 'Verify ownership depth' },
    rationale: 'Potential fit, pending employer screening.',
    matches: [{ claimId: 'notice', jdEvidence: 'Build production software.', explanation: 'Synthetic fixture only.' }],
    gaps: [{ detail: 'Team expectations unknown', sourceUrl: job.url }],
    positioning: 'Focus on demonstrated engineering delivery' };
}
