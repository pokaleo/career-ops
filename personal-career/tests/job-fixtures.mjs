import { evaluateEligibility } from '../assessment.mjs';

export function jobFixture(overrides = {}) {
  return { company: 'Example Ltd', title: 'AI Engineer', url: 'https://example.invalid/jobs?id=123&utm_source=mail',
    namespace: 'example-ats', requisitionId: '123', jdText: 'Build production software.',
    checkedAt: '2026-10-20T12:00:00Z', facts: { baseGBP: { min: 75000, max: 100000 },
      sponsorship: 'confirmed', london: true, ukRemoteFromLondon: false, workModel: 'hybrid' }, ...overrides };
}
export function assessmentFixture(run, job = run.jobs[0]) {
  return { version: 1, jobId: job.id, snapshotHash: run.profileHash, jdHash: job.jdHash,
    eligibility: evaluateEligibility(job, run.settings), fit: 'Moderate',
    dimensions: { skills: 'Relevant document workflow experience', seniority: 'Verify ownership depth' },
    rationale: 'Potential fit, pending employer screening.',
    matches: [{ claimId: 'notice', jdEvidence: 'Build production software.', explanation: 'Synthetic fixture only.' }],
    gaps: [{ detail: 'Team expectations unknown', sourceUrl: job.url }],
    positioning: 'Focus on demonstrated engineering delivery' };
}
