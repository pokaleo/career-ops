#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolveRuntime } from './runtime.mjs';
import { check } from './contracts.mjs';
import { ingestRun, saveAssessments } from './assessment.mjs';
import { recordSelection, revokeSelection, requireSelection } from './selection.mjs';

try {
  const [command, file = '-'] = process.argv.slice(2);
  const input = JSON.parse(readFileSync(file === '-' ? 0 : file, 'utf8'));
  const rt = resolveRuntime({ dataRoot: input.dataRoot });
  let result;
  switch (command) {
    case 'ingest': result = ingestRun(input.snapshot, input.jobs, rt, input); break;
    case 'assess': result = saveAssessments(input.runId, input.assessments, rt); break;
    case 'select': result = recordSelection(input, rt); break;
    case 'revoke': result = revokeSelection(input, rt); break;
    case 'materials-check': result = requireSelection(input, rt); break;
    default: check(false, `Unknown command: ${command}`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = error.code === 3 ? 3 : 2;
}
