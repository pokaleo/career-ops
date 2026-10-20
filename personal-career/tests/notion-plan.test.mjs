import test from 'node:test';
import assert from 'node:assert/strict';
import { planUpdate, reconcileOperation, journalOperation } from '../notion-plan.mjs';
import { resolveRuntime } from '../runtime.mjs';
import { temporaryRoots } from './fixtures.mjs';
const base = () => ({ pageId: 'page-1', schemaHash: 'schema', properties: { Stage: 'Wishlist', Fit: 'Moderate', Notes: 'My notes', Status: ['old'], 'CV Version': ['cv-old'] }, sections: {} });
const ownership = { properties: ['Company','Position','Stage','Fit','CV Version'], section: 'career-workflow' };
const intent = values => ({ operationId: 'op-1', kind: 'assess', identity: 'job-1', properties: values });
test('patches are minimal, three-way, preserve human fields and union CV versions', () => {
  const b = base(), c = base(); c.properties.Notes = 'New human notes';
  const p = planUpdate(b, c, intent({ Fit: 'Strong', Notes: 'Do not overwrite', Status: ['new'], 'CV Version': ['cv-new'] }), ownership);
  assert.deepEqual(p.properties, { Fit: 'Strong', 'CV Version': ['cv-old','cv-new'] });
  assert.equal(p.expected.Fit, 'Moderate'); assert.equal(p.conflicts.length, 0);
  c.properties.Fit = 'Stretch';
  assert.ok(planUpdate(b, c, intent({ Fit: 'Strong' }), ownership).conflicts.includes('Fit'));
  c.properties.Fit = 'Strong';
  assert.deepEqual(planUpdate(b, c, intent({ Fit: 'Strong' }), ownership).properties, {});
  assert.deepEqual(planUpdate(b, c, intent({}), ownership).properties, {});
  assert.throws(() => planUpdate(b, c, intent({ 'Last Contact': '2026-10-20' }), ownership), /event/i);
});
test('stage changes require explicit selection, no downgrade, new pages are Wishlist', () => {
  assert.equal(planUpdate(null, null, intent({ Company: 'Example', Stage: 'Applied' }), ownership).properties.Stage, 'Wishlist');
  assert.equal(planUpdate(base(), base(), { ...intent({}), kind: 'select', requestRef: 'user:3' }, ownership).properties.Stage, 'Preparing');
  assert.throws(() => planUpdate(base(), base(), { ...intent({}), kind: 'select' }, ownership), /request/i);
  for (const stage of ['Applied','Technical Interview','On Hold','Rejected']) {
    const b = base(); b.properties.Stage = stage;
    assert.equal(planUpdate(b, b, { ...intent({ Stage: 'Preparing' }), kind: 'select', requestRef: 'user:3' }, ownership).properties.Stage, undefined);
  }
  assert.throws(() => planUpdate(base(), base(), { ...intent({}), writeDisposition: 'deferred' }, ownership), /deferred/i);
});
test('only the owned body section can be replaced and duplicated markers conflict', () => {
  const b = base(); b.sections = { 'career-workflow': 'old', personal: 'keep' };
  const p = planUpdate(b, b, { ...intent({}), body: 'new' }, ownership);
  assert.deepEqual(p.sections, { 'career-workflow': 'new' });
  assert.equal(planUpdate(b, { ...b, duplicateMarkers: ['career-workflow'] }, { ...intent({}), body: 'new' }, ownership).conflicts.length, 1);
});
test('lost create responses adopt a single marker and never authorize blind retries', t => {
  const p = planUpdate(null, null, intent({ Company: 'Example' }), ownership);
  const rt = resolveRuntime(temporaryRoots(t)); journalOperation(p, rt);
  const lost = reconcileOperation(p, null, []);
  assert.equal(lost.state, 'pending_reconciliation'); assert.equal(lost.retryCreate, false);
  const observed = { pageId: 'new-page', operationId: 'op-1', properties: p.properties, sections: p.sections };
  assert.equal(reconcileOperation(p, null, [observed]).state, 'verified');
  assert.equal(reconcileOperation(p, null, [observed, { ...observed, pageId: 'duplicate' }]).state, 'conflict');
  assert.equal(reconcileOperation(p, { async: true }, []).state, 'pending_reconciliation');
});
test('partial readbacks remain pending; conflicting touched values stop updates', () => {
  const p = planUpdate(base(), base(), intent({ Fit: 'Strong', 'CV Version': ['new'] }), ownership);
  const partial = base(); partial.properties.Fit = 'Strong';
  const result = reconcileOperation(p, { success: true }, [partial]);
  assert.equal(result.state, 'pending_readback'); assert.deepEqual(Object.keys(result.remainingPatch.properties), ['CV Version']);
  partial.properties['CV Version'] = ['human-only'];
  assert.equal(reconcileOperation(p, {}, [partial]).state, 'conflict');
});
test('Notion transport escapes of literal colons do not cause false body conflicts', () => {
  const p = planUpdate(null, null, { ...intent({ Company: 'Example' }), body: 'Identity: ats:example:123' }, ownership);
  const observed = { pageId: 'new', operationId: p.operationId, properties: p.properties, sections: { 'career-workflow': 'Identity: ats\\:example\\:123' } };
  assert.equal(reconcileOperation(p, {}, [observed]).state, 'verified');
  observed.sections['career-workflow'] = 'Identity: ats\\:example\\:456';
  assert.equal(reconcileOperation(p, {}, [observed]).state, 'conflict');
});
