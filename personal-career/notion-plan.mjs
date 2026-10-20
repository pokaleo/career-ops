import { check, blocked, keys, oneOf, string, safeId } from './contracts.mjs';
import { contentHash, writeJson, withLock } from './runtime.mjs';

const equal = (a, b) => contentHash(a ?? null) === contentHash(b ?? null);
const eventField = k => /date|contact|recruiter/i.test(k);
/**
 * Pure plan only. Caller must fetch schema/current immediately before journaling and
 * writing. Notion has no compare-and-swap; a later readback is still mandatory.
 */
export function planUpdate(base, current, intent, ownership) {
  keys(intent, ['operationId','kind','identity','properties','body','requestRef','writeDisposition','confirmedEvent','schemaHash'], 'Notion intent');
  safeId(intent.operationId); string(intent.identity, 'identity');
  oneOf(intent.kind, ['assess','select','materials','event'], 'Notion intent kind');
  blocked(intent.writeDisposition !== 'deferred', 'Deferred correction cannot be written');
  const create = !base && !current; check(create || (base && current && base.pageId === current.pageId), 'Page identity mismatch');
  if (intent.kind === 'select') string(intent.requestRef, 'Selection request reference');
  const properties = {}, expected = {}, sections = {}, expectedSections = {}, conflicts = [];
  if (!create && base.schemaHash !== current.schemaHash) conflicts.push('schema');
  const desired = { ...(intent.properties ?? {}) };
  if (create) desired.Stage = 'Wishlist';
  else if (intent.kind === 'select' && current.properties.Stage === 'Wishlist') desired.Stage = 'Preparing';
  else delete desired.Stage;
  for (const [key, value] of Object.entries(desired)) {
    if (value === undefined) continue;
    if (['Notes','Status'].includes(key)) continue;
    if (eventField(key)) {
      check(intent.kind === 'event' && intent.confirmedEvent?.requestRef, `${key} requires a confirmed event or explicit scheduling request`);
      check(intent.confirmedEvent.allowedFields?.includes(key), `${key} not authorized by event`);
    }
    check(ownership.properties.includes(key), `Property is not owned: ${key}`);
    let target = value;
    const old = base?.properties?.[key] ?? null, now = current?.properties?.[key] ?? null;
    if (key === 'CV Version') {
      check(Array.isArray(value) && (now === null || Array.isArray(now)), 'CV Version must be an array');
      target = [...new Set([...(now ?? []), ...value])];
    }
    if (equal(now, target)) continue;
    if (!create && key !== 'CV Version' && !equal(old, now)) { conflicts.push(key); continue; }
    expected[key] = now; properties[key] = target;
  }
  if (intent.body !== undefined) {
    string(ownership.section, 'Owned section'); string(intent.body, 'Managed body');
    if (current?.duplicateMarkers?.includes(ownership.section)) conflicts.push('duplicate_body_marker');
    else {
      const old = base?.sections?.[ownership.section] ?? null, now = current?.sections?.[ownership.section] ?? null;
      if (!equal(now, intent.body)) {
        if (!equal(old, now)) conflicts.push('body');
        else { expectedSections[ownership.section] = now; sections[ownership.section] = intent.body; }
      }
    }
  }
  return { version: 1, operationId: intent.operationId, kind: create ? 'create' : 'update', identity: intent.identity,
    pageId: current?.pageId ?? null, schemaHash: current?.schemaHash ?? intent.schemaHash ?? null,
    sourceHash: contentHash(base ?? {}), expected, expectedSections, properties, sections, conflicts };
}
export function journalOperation(plan, rt) {
  safeId(plan.operationId); blocked(plan.conflicts.length === 0, 'Conflicted plan cannot be journaled for execution');
  return withLock(rt, `operation-${plan.operationId}`, () => {
    writeJson(rt, `operations/${plan.operationId}/plan.json`, plan, { immutable: true });
    return { operationId: plan.operationId, marker: `career-ops-operation:${plan.operationId}`, state: 'pending_readback' };
  });
}
export function reconcileOperation(operation, receipt, observations) {
  const empty = { properties: {}, sections: {} };
  if (operation.conflicts.length) return { state: 'conflict', remainingPatch: empty, conflicts: operation.conflicts, retryCreate: false };
  if (operation.kind === 'update' && !Object.keys(operation.properties).length && !Object.keys(operation.sections).length) {
    return { state: 'no_op', remainingPatch: empty, conflicts: [], retryCreate: false };
  }
  const matches = observations.filter(o => operation.kind === 'create' ? o.operationId === operation.operationId : o.pageId === operation.pageId);
  if (matches.length > 1) return { state: 'conflict', remainingPatch: empty, conflicts: ['multiple_matching_pages'], retryCreate: false };
  if (!matches.length) return {
    state: receipt?.definiteFailure === true ? 'definite_failure' : operation.kind === 'create' ? 'pending_reconciliation' : 'pending_readback',
    remainingPatch: empty, conflicts: [], retryCreate: false,
  };
  const observed = matches[0], remainingPatch = { properties: {}, sections: {} }, conflicts = [];
  for (const [section, expectedKey] of [['properties','expected'], ['sections','expectedSections']]) {
    for (const [key, desired] of Object.entries(operation[section])) {
      const now = observed[section]?.[key] ?? null;
      // Relations may acquire extra human-added versions after the write.
      const applied = section === 'properties' && key === 'CV Version' && Array.isArray(now) ? desired.every(v => now.includes(v)) : equal(now, desired);
      if (applied) continue;
      if (equal(now, operation[expectedKey][key])) remainingPatch[section][key] = desired;
      else conflicts.push(`${section}.${key}`);
    }
  }
  return { state: conflicts.length ? 'conflict' : Object.values(remainingPatch).some(v => Object.keys(v).length) ? 'pending_readback' : 'verified',
    pageId: observed.pageId, remainingPatch, conflicts, retryCreate: false };
}
