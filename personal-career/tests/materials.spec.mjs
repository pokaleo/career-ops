import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { prepareMaterials, validateMaterialPayload, saveMaterialPayload, renderMaterials, verifyArtifacts } from '../materials.mjs';
import { ingestRun, saveAssessments } from '../assessment.mjs';
import { recordSelection } from '../selection.mjs';
import { resolveRuntime } from '../runtime.mjs';
import { jobFixture, assessmentFixture } from './job-fixtures.mjs';
import { snapshotFixture, settingsFixture, temporaryRoots } from './fixtures.mjs';
export function materialFixture(t, format = 'text') {
  const rt = resolveRuntime(temporaryRoots(t)), snapshot = snapshotFixture(), settings = settingsFixture();
  const run = ingestRun(snapshot,[jobFixture()],rt,{settings,brief:'Fictional evidence'});
  saveAssessments(run.runId,[assessmentFixture(run)],rt);
  const input = { jobId:run.jobs[0].id, runId:run.runId, snapshot,settings,currentJob:run.jobs[0],claimIds:['promotion'],format };
  return {rt,run,input};
}
test('material context gates current evidence, actual selection and permitted claims before writing', t => {
  const {rt,run,input}=materialFixture(t);
  assert.throws(()=>prepareMaterials(input,rt),/select/i);
  assert.equal(existsSync(join(rt.stateRoot,'materials')),false);
  recordSelection({runId:run.runId,jobIds:[input.jobId],requestRef:'user:select'},rt);
  assert.throws(()=>prepareMaterials({...input,claimIds:['missing']},rt),/claim/i);
  assert.throws(()=>prepareMaterials({...input,claimIds:['metric']},rt),/claim/i);
  assert.throws(()=>prepareMaterials({...input,currentJob:{...input.currentJob,jdText:'changed',jdHash:undefined}},rt),/stale/i);
  const c=prepareMaterials(input,rt);
  assert.equal(c.claims[0].qualifier,'expected');
  assert.throws(()=>validateMaterialPayload({version:1,jobId:c.jobId,statements:[{text:'Promotion attained',claimIds:['promotion'],qualifiers:{promotion:'attained'}}]},c),/qualifier/i);
  assert.throws(()=>validateMaterialPayload({version:1,jobId:c.jobId,statements:[{text:'Improved by 80%',claimIds:['promotion'],qualifiers:{promotion:'expected'}}]},c),/numeric|qualifier/i);
  assert.equal(validateMaterialPayload({version:1,jobId:c.jobId,statements:[{text:'Manager promotion expected next year',claimIds:['promotion'],qualifiers:{promotion:'expected'}}]},c).version,1);
});
test('renderer uses argument arrays, private paths and records failure; verification needs actual review', t => {
  const {rt,run,input}=materialFixture(t,'latex');
  recordSelection({runId:run.runId,jobIds:[input.jobId],requestRef:'user:select'},rt);
  const c=prepareMaterials(input,rt);
  const dir=join(rt.dataRoot,'output');mkdirSync(dir);
  saveMaterialPayload({version:1,jobId:c.jobId,statements:[{text:'Manager promotion expected next year',claimIds:['promotion'],qualifiers:{promotion:'expected'}}]},c,rt);
  writeFileSync(join(dir,'source.tex'),'fictional source');
  let calls=0;
  assert.throws(()=>renderMaterials(c,{source:'../escape.tex',pdf:'output/result.pdf'},rt,()=>{calls++;}),/path/i);
  assert.equal(calls,0);
  assert.throws(()=>renderMaterials(c,{source:'output/source.tex',pdf:'output/result.pdf'},rt,(command,args,opts)=>{
    calls++;assert.ok(Array.isArray(args));assert.ok(args.some(x=>x.endsWith('generate-latex.mjs')));assert.equal(opts.shell,false);
    return {status:1,stderr:'compile failed'};
  }),/render/i);
  writeFileSync(join(dir,'result.pdf'),'%PDF-1.7\nfictional fixture, not a real deliverable');
  const paths={source:'output/source.tex',pdf:'output/result.pdf',review:{semanticRef:'review:1',visualRef:null}};
  assert.equal(verifyArtifacts(c,paths,rt).verified,false);
  assert.throws(()=>verifyArtifacts(c,{...paths,pdf:'../outside.pdf'},rt),/path/i);
});
test('one selection supports immutable editorial revisions and multiple output formats', t => {
  const {rt,run,input}=materialFixture(t);
  const selection=recordSelection({runId:run.runId,jobIds:[input.jobId],requestRef:'user:select'},rt);
  const first=prepareMaterials(input,rt);
  saveMaterialPayload({version:1,jobId:first.jobId,statements:[{text:'Manager promotion expected next year',claimIds:['promotion'],qualifiers:{promotion:'expected'}}]},first,rt);
  const second=prepareMaterials(input,rt);
  assert.notEqual(first.attemptId,second.attemptId);
  saveMaterialPayload({version:1,jobId:second.jobId,statements:[{text:'Expected manager promotion next year',claimIds:['promotion'],qualifiers:{promotion:'expected'}}]},second,rt);
  const latex=prepareMaterials({...input,format:'latex'},rt);
  assert.equal(latex.selectionId,selection.id);
  assert.equal(latex.format,'latex');
});
