import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSupportContext, validateEvent, draftActions } from '../support.mjs';
import { planUpdate } from '../notion-plan.mjs';
import { snapshotFixture } from './fixtures.mjs';
const snapshot = () => {
  const s=snapshotFixture();s.records=[{pageId:'existing-app',properties:{Stage:'Technical Interview','CV Version':['prepared-new']},submittedCV:{id:'submitted-old',confirmedBy:'user:submitted'},events:[]}];return s;
};
test('existing applications can get prep, using the actual submitted CV without discovery', () => {
  const c=buildSupportContext({applicationId:'existing-app',snapshot:snapshot(),requestKind:'interview'});
  assert.equal(c.stage,'Technical Interview');assert.equal(c.submittedCV.id,'submitted-old');
  assert.equal(c.selectionRequired,false);
  assert.equal(draftActions(c)[0].state,'proposed');
});
test('drafts and interview completion cannot claim submission, sending or a passed round', () => {
  const c=buildSupportContext({applicationId:'existing-app',snapshot:snapshot(),requestKind:'followup'});
  const event={version:1,applicationId:'existing-app',kind:'interview_completed',state:'confirmed',requestRef:'user:4',actualDate:null};
  assert.equal(validateEvent(event,c).actualDate,null);
  assert.throws(()=>validateEvent({...event,stage:'Final Interview'},c),/stage/i);
  assert.throws(()=>validateEvent({...event,kind:'cv_prepared',stage:'Applied'},c),/kind/i);
  assert.throws(()=>validateEvent({...event,kind:'followup_sent',state:'draft'},c),/confirmed/i);
  assert.throws(()=>validateEvent({...event,requestRef:''},c),/request/i);
});
test('deferred rejection affects recommendations without creating a Notion patch', () => {
  const s=snapshot();s.claims.push({...s.claims[0],id:'closed',key:'application:existing-app:stage',value:'Rejected',writeDisposition:'deferred'});
  const c=buildSupportContext({applicationId:'existing-app',snapshot:s,requestKind:'followup'});
  assert.equal(c.stage,'Rejected');assert.equal(c.pendingCorrections.length,1);
  assert.deepEqual(draftActions(c),[]);assert.equal(c.notionPatch,undefined);
});
test('only a validated confirmed event authorizes an actual stage transition', () => {
  const b={pageId:'existing-app',schemaHash:'s',properties:{Stage:'Preparing'},sections:{}};
  const event={version:1,applicationId:'existing-app',kind:'applied',state:'confirmed',requestRef:'user:sent',actualDate:null};
  const p=planUpdate(b,b,{operationId:'apply-1',identity:'existing-app',kind:'event',properties:{Stage:'Applied'},confirmedEvent:event},{properties:['Stage'],section:'career-workflow'});
  assert.equal(p.properties.Stage,'Applied');
  assert.throws(()=>planUpdate(b,b,{operationId:'apply-2',identity:'existing-app',kind:'event',properties:{Stage:'Applied'},confirmedEvent:{...event,state:'draft'}},{properties:['Stage'],section:'career-workflow'}),/confirmed/i);
});
