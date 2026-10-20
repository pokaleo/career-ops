import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { getProfilePath } from '../path-resolver.mjs';
import { check, blocked, keys, array, string, oneOf, version, safeId } from './contracts.mjs';
import { contentHash, readJson, writeJson, boundedPath } from './runtime.mjs';
import { permittedClaims, profileHash, validateSnapshot } from './snapshot.mjs';
import { validateJob } from './assessment.mjs';
import { requireSelection } from './selection.mjs';

function prefix(c) { return `materials/${safeId(c.jobId)}/${safeId(c.selectionId)}/${safeId(c.attemptId)}`; }
function currentContext(c, rt) {
  const saved = readJson(rt, `${prefix(c)}/context.json`);
  blocked(contentHash(saved) === contentHash(c), 'Material context differs from authorized context');
  requireSelection({jobId:c.jobId,snapshotHash:c.profileHash,jdHash:c.jdHash},rt);
  return saved;
}
export function prepareMaterials({jobId,runId,snapshot,settings,currentJob,claimIds,format,attemptId=randomUUID()}, rt) {
  safeId(jobId); safeId(runId); validateSnapshot(snapshot); validateJob(currentJob);
  check(currentJob.id === jobId, 'Material job mismatch'); oneOf(format,['text','html','latex'],'material format');
  const hash = profileHash(snapshot,settings), jdHash = contentHash(currentJob.jdText);
  const selection = requireSelection({jobId,snapshotHash:hash,jdHash},rt);
  blocked(snapshot.sources.every(s=>s.completeness === 'complete'),'Material sources must be complete');
  array(claimIds,'claim IDs'); check(claimIds.length > 0,'At least one claim required');
  const permitted=permittedClaims(snapshot), claims=claimIds.map(id=>{
    const c=permitted.find(c=>c.id===id);check(c,'Unknown or unconfirmed material claim');return c;
  });
  const context={version:1,jobId,runId,selectionId:selection.id,attemptId:safeId(attemptId),profileHash:hash,jdHash,format,claims};
  writeJson(rt,`${prefix(context)}/context.json`,context,{immutable:true});
  return context;
}
export function validateMaterialPayload(payload,c) {
  keys(payload,['version','jobId','statements'],'material payload');version(payload);
  check(payload.jobId===c.jobId,'Material payload job mismatch');array(payload.statements,'statements');
  check(payload.statements.length>0,'Empty material payload');
  for(const s of payload.statements) {
    keys(s,['text','claimIds','qualifiers'],'statement');string(s.text,'statement text');array(s.claimIds,'statement claims');
    check(s.claimIds.length>0,'Statement needs source claims');
    const claims=s.claimIds.map(id=>{const claim=c.claims.find(x=>x.id===id);check(claim,'Unknown statement claim');return claim;});
    for(const claim of claims) if(claim.qualifier) {
      check(s.qualifiers?.[claim.id]===claim.qualifier && s.text.toLowerCase().includes(claim.qualifier.toLowerCase()),'Missing or changed expected/pending qualifier');
    }
    const allowed=new Set(claims.flatMap(c=>c.value.match(/\d+(?:[.,]\d+)*(?:%|\+)?/g)??[]));
    check((s.text.match(/\d+(?:[.,]\d+)*(?:%|\+)?/g)??[]).every(n=>allowed.has(n)),'Unsupported numeric material claim');
  }
  return payload;
}
export function saveMaterialPayload(payload,c,rt) {
  currentContext(c,rt);validateMaterialPayload(payload,c);
  writeJson(rt,`${prefix(c)}/payload.json`,payload,{immutable:true});return payload;
}
export function renderMaterials(c,paths,rt,runner=spawnSync) {
  currentContext(c,rt);
  const source=boundedPath(rt.dataRoot,paths.source),pdf=boundedPath(rt.dataRoot,paths.pdf);
  check(c.format!=='text','Text format does not need a PDF renderer');
  check(extname(source)===(c.format==='latex'?'.tex':'.html') && extname(pdf)==='.pdf','Material file extensions');
  check(existsSync(source),'Material source missing');
  validateMaterialPayload(readJson(rt,`${prefix(c)}/payload.json`),c);
  mkdirSync(dirname(pdf),{recursive:true,mode:0o700});
  const script=join(rt.repoRoot,c.format==='latex'?'generate-latex.mjs':'generate-pdf.mjs');
  const args=[script,source,pdf,...(c.format==='latex'?['--compile-only']:['--format=a4','--kind=cv'])];
  const result=runner(process.execPath,args,{cwd:rt.repoRoot,encoding:'utf8',shell:false,timeout:120000,
    env:{...process.env,CAREER_OPS_ROOT:rt.dataRoot,CAREER_OPS_DATA_DIR:rt.dataRoot,CAREER_OPS_PROFILE:getProfilePath(rt.dataRoot)}});
  const record={status:result.status??null,error:result.error?.message??null,source:paths.source,pdf:paths.pdf,sourceHash:contentHash(readFileSync(source,'utf8')),
    pdfHash:result.status===0 && existsSync(pdf)?contentHash(readFileSync(pdf).toString('base64')):null,stderr:result.stderr??'',stdout:result.stdout??''};
  writeJson(rt,`${prefix(c)}/render.json`,record);
  blocked(result.status===0 && record.pdfHash,'Material render failed; see private render record');
  return record;
}
export function verifyArtifacts(c,paths,rt) {
  currentContext(c,rt);
  const source=boundedPath(rt.dataRoot,paths.source),findings=[],files=[];
  if(!existsSync(source)) findings.push('source_missing');
  else files.push({path:source,hash:contentHash(readFileSync(source).toString('base64'))});
  if(!paths.review?.semanticRef) findings.push('semantic_review_required');
  if(c.format!=='text') {
    const pdf=boundedPath(rt.dataRoot,paths.pdf);
    if(!existsSync(pdf) || !readFileSync(pdf).subarray(0,5).equals(Buffer.from('%PDF-'))) findings.push('pdf_missing_or_invalid');
    else files.push({path:pdf,hash:contentHash(readFileSync(pdf).toString('base64'))});
    if(!paths.review?.visualRef) findings.push('visual_review_required');
    const renderPath=`${prefix(c)}/render.json`;
    if(!existsSync(boundedPath(rt.stateRoot,renderPath))) findings.push('render_not_verified');
    else {
      const r=readJson(rt,renderPath);
      if(r.status!==0 || r.source!==paths.source || r.pdf!==paths.pdf || !existsSync(pdf) ||
        r.pdfHash!==contentHash(readFileSync(pdf).toString('base64')) || !existsSync(source) || r.sourceHash!==contentHash(readFileSync(source,'utf8'))) findings.push('render_failed_or_artifacts_changed');
    }
  }
  const payloadPath=`${prefix(c)}/payload.json`;
  if(!existsSync(boundedPath(rt.stateRoot,payloadPath))) findings.push('validated_payload_required');
  else validateMaterialPayload(readJson(rt,payloadPath),c);
  const manifest={version:1,jobId:c.jobId,selectionId:c.selectionId,attemptId:c.attemptId,profileHash:c.profileHash,jdHash:c.jdHash,format:c.format,
    files,review:paths.review??null,verified:findings.length===0,findings};
  writeJson(rt,`${prefix(c)}/manifest.json`,manifest);
  return {verified:manifest.verified,findings,manifest};
}
