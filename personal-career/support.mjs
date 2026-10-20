import { check, blocked, keys, oneOf, string, timestamp, version } from './contracts.mjs';
import { validateSnapshot, effectiveClaims } from './snapshot.mjs';

export const eventStages={applied:'Applied',rejected:'Rejected',offer:'Offer',accepted:'Accepted',withdrawn:'Withdrawn'};
export function buildSupportContext({applicationId,snapshot,requestKind}) {
  validateSnapshot(snapshot);string(applicationId,'application ID');
  oneOf(requestKind,['interview','debrief','negotiation','followup'],'support kind');
  const matches=snapshot.records.filter(r=>r.pageId===applicationId);
  blocked(matches.length===1,'Application missing or ambiguous');
  const record=matches[0],claims=effectiveClaims(snapshot);
  const corrections=claims.filter(c=>c.key.startsWith(`application:${applicationId}:`) && c.status==='confirmed' && c.evidenceKind==='user_statement');
  const stages=corrections.filter(c=>c.key===`application:${applicationId}:stage`);
  blocked(new Set(stages.map(c=>c.value)).size<=1,'Conflicting application stage corrections');
  const context={version:1,applicationId,requestKind,stage:stages[0]?.value??record.properties.Stage??null,
    submittedCV:record.submittedCV??null,events:[],claims,
    sourceCompleteness:snapshot.sources.map(s=>({id:s.id,completeness:s.completeness,retrievedAt:s.retrievedAt})),
    pendingCorrections:corrections.filter(c=>c.writeDisposition==='deferred'),selectionRequired:false};
  context.events=(record.events??[]).map(e=>validateEvent(e,context));
  return context;
}
export function validateEvent(event,context) {
  keys(event,['version','applicationId','kind','state','requestRef','actualDate','stage','allowedFields'],'event');
  version(event);check(event.applicationId===context.applicationId,'Event application mismatch');
  oneOf(event.kind,['applied','interview_scheduled','interview_completed','interview_passed','rejected','offer','accepted','withdrawn','followup_sent','schedule_followup'],'event kind');
  check(event.state==='confirmed','Event must be confirmed; drafts are not events');string(event.requestRef,'Event user request reference');
  timestamp(event.actualDate,'Actual event date',true);
  if(event.stage!==undefined) check(eventStages[event.kind]===event.stage,'Event does not authorize that stage');
  if(event.allowedFields!==undefined) check(Array.isArray(event.allowedFields),'Event allowed fields');
  return event;
}
export function draftActions(context) {
  if(['Rejected','Withdrawn','Accepted'].includes(context.stage)) return [];
  if(context.requestKind==='interview') return [{applicationId:context.applicationId,kind:'prepare_interview',state:'proposed',
    rationale:context.submittedCV?'Prepare against the actual submitted CV and current JD.':'Confirm which CV was submitted before practising claims attributed to it.',suggestedDate:null}];
  if(context.requestKind==='negotiation') return [{applicationId:context.applicationId,kind:'prepare_negotiation',state:'proposed',rationale:'Compare confirmed base, sponsorship, role scope and work expectations; prepare evidence-backed asks.',suggestedDate:null}];
  if(context.requestKind==='debrief') return [{applicationId:context.applicationId,kind:'debrief',state:'proposed',rationale:'Record actual questions, answers and feedback separately from inferred outcome.',suggestedDate:null}];
  return [{applicationId:context.applicationId,kind:'followup_draft',state:'draft',rationale:context.stage==='On Hold'?'Verify hiring timing and current process status.':'Review confirmed events and employer commitments before proposing a follow-up.',suggestedDate:null}];
}
