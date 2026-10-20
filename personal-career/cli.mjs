#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolveRuntime } from './runtime.mjs';
import { check } from './contracts.mjs';
import { ingestRun, saveAssessments, bindIdentity } from './assessment.mjs';
import { recordSelection, revokeSelection, requireSelection } from './selection.mjs';
import { planUpdate, journalOperation, reconcileOperation } from './notion-plan.mjs';
import { projectProfile } from './snapshot.mjs';
import { prepareMaterials, saveMaterialPayload, renderMaterials, verifyArtifacts } from './materials.mjs';
import { buildSupportContext, validateEvent, draftActions } from './support.mjs';

try {
  const [command, file = '-'] = process.argv.slice(2);
  const input = JSON.parse(readFileSync(file === '-' ? 0 : file, 'utf8'));
  const rt = resolveRuntime({ dataRoot: input.dataRoot });
  let result;
  switch (command) {
    case 'profile': result = projectProfile(input.snapshot, input.settings); break;
    case 'ingest': result = ingestRun(input.snapshot, input.jobs, rt, input); break;
    case 'assess': result = saveAssessments(input.runId, input.assessments, rt); break;
    case 'bind-identity': result = bindIdentity(input.job, input.verification, rt); break;
    case 'select': result = recordSelection(input, rt); break;
    case 'revoke': result = revokeSelection(input, rt); break;
    case 'materials-check': result = requireSelection(input, rt); break;
    case 'plan-notion': result = planUpdate(input.base, input.current, input.intent, input.ownership); break;
    case 'journal': result = journalOperation(input.plan, rt); break;
    case 'reconcile': result = reconcileOperation(input.plan, input.receipt, input.observations); break;
    case 'materials-prepare': result = prepareMaterials(input, rt); break;
    case 'materials-payload': result = saveMaterialPayload(input.payload, input.context, rt); break;
    case 'materials-render': result = renderMaterials(input.context, input.paths, rt); break;
    case 'materials-verify': result = verifyArtifacts(input.context, input.paths, rt); break;
    case 'support': result = buildSupportContext(input); break;
    case 'event-check': result = validateEvent(input.event, input.context); break;
    case 'actions': result = draftActions(input.context); break;
    default: check(false, `Unknown command: ${command}`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.conflicts?.length || (command === 'reconcile' && !['verified','no_op'].includes(result.state))
    || (command === 'materials-verify' && !result.verified)) process.exitCode = 3;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = error.code === 3 ? 3 : 2;
}
