import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const digest = text => createHash('sha256').update(text).digest('hex');
export const settingsFixture = () => ({
  version: 1,
  candidate: { name: 'Example Candidate', headline: 'AI Engineer' },
  compensation: { minimumBaseGBP: 70000, targetBaseGBP: [75000, 100000] },
  sponsorship: { required: true, months: 24, unrestrictedCountries: [] },
  location: { london: true, ukRemoteFromLondon: true, hybridPreferred: true },
  roleFamilies: ['applied-ai', 'ai-product', 'forward-deployed', 'architect-lead', 'backend-platform'],
  cadence: 'on-demand', shortlistLimit: 10,
});
export function snapshotFixture() {
  const content = 'Candidate has built document workflows. Notice is three months. Promotion is expected.';
  return {
    version: 1, runId: 'run-1', retrievedAt: '2026-10-20T12:00:00Z',
    schema: { dataSourceId: 'fictional-db', fingerprint: 'schema-1', properties: {
      Company: { type: 'title' }, Position: { type: 'text' }, Stage: { type: 'status' },
      Notes: { type: 'text' }, 'CV Version': { type: 'relation' },
    } },
    sources: [{ id: 'source-1', url: 'https://example.invalid/profile', kind: 'conversation',
      content, contentHash: digest(content), sourceEditedAt: null,
      retrievedAt: '2026-10-20T12:00:00Z', completeness: 'complete' }],
    claims: [
      { id: 'notice', key: 'notice', value: 'Three months notice', sourceId: 'source-1',
        locator: 'employment', evidenceKind: 'user_statement', status: 'confirmed',
        writeDisposition: 'allowed', supersedes: [] },
      { id: 'promotion', key: 'promotion', value: 'Manager promotion expected next year',
        qualifier: 'expected', sourceId: 'source-1', locator: 'employment',
        evidenceKind: 'user_statement', status: 'confirmed', writeDisposition: 'allowed', supersedes: [] },
      { id: 'metric', key: 'metric', value: 'Improved accuracy by 80%', sourceId: 'source-1',
        locator: 'unverified rehearsal', evidenceKind: 'coaching', status: 'unresolved',
        writeDisposition: 'allowed', supersedes: [] },
    ],
    records: [], identityIndexComplete: true,
  };
}
export function temporaryRoots(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'personal-career-test-')));
  const repoRoot = join(root, 'code'), dataRoot = join(root, 'private');
  mkdirSync(repoRoot); mkdirSync(dataRoot);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, repoRoot: resolve(repoRoot), dataRoot: resolve(dataRoot) };
}
