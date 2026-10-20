import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, copyFileSync, unlinkSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { listTree } from '../lib/walk-tree.mjs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { check, blocked, string, array, keys, safeId, timestamp } from './contracts.mjs';
import { boundedPath, contentHash, readJson, writeJson, withLock } from './runtime.mjs';
import { reconcileOperation } from './notion-plan.mjs';

/**
 * Notion is the master store; the data root is a local mirror. One ledger
 * (sync/ledger.json) records the content hash of every user-layer file at its
 * last verified pull or push, so `syncStatus` can list exactly what is not yet
 * in Notion. A push is recorded only from a verified reconciliation.
 */
const LEDGER = 'sync/ledger.json';
/** Where each local artifact lives in Notion. Order matters: first match wins. */
export const ARTIFACTS = [
  { kind: 'profile-source', match: p => ['cv.md', 'article-digest.md'].includes(p), target: 'profile', section: 'career-workflow-cv' },
  { kind: 'story-bank', match: p => p === 'interview-prep/story-bank.md', target: 'profile', section: 'career-workflow-story-bank' },
  { kind: 'report', match: p => /^reports\/\d{3,4}-[^/]+\.md$/.test(p) && !p.endsWith('-RESERVED.md'), target: 'application', section: 'career-workflow' },
  { kind: 'interview', match: p => /^interview-prep\/(sessions\/)?[^/]+\.md$/.test(p) && !/\/(README|question-bank)\.md$/.test(p), target: 'application', section: 'career-workflow-interview' },
  { kind: 'followups', match: p => p === 'data/follow-ups.md', target: 'applications', section: 'career-workflow-followups' },
  { kind: 'material', match: p => /^output\/[^/]+\.(pdf|html|tex|md|docx)$/.test(p), target: 'cv-library', section: 'career-workflow' },
];
export const PULL_TARGETS = ['cv.md', 'article-digest.md', 'config/profile.yml', 'modes/_profile.md', 'modes/_brief.md'];
const EXPERIENCE = /^## +(?:\*\*)?\[?(?:Experience|Work Experience|Professional Experience|Employment History|Work History)\b/mi;

const ledger = rt => existsSync(boundedPath(rt.stateRoot, LEDGER)) ? readJson(rt, LEDGER) : {};
const fileHash = file => contentHash(readFileSync(file).toString('base64'));
const artifactFor = path => ARTIFACTS.find(a => a.match(path)) ?? null;
/** Data-root-relative files under `dir`, through the repo's one guarded walker. */
function walk(root, dir) {
  const abs = join(root, dir);
  return existsSync(abs) ? listTree(abs).map(f => relative(root, f).split(sep).join('/')) : [];
}

export function syncStatus(rt) {
  const entries = ledger(rt), files = [
    ...['cv.md', 'article-digest.md', 'data/follow-ups.md', 'interview-prep/story-bank.md'].filter(p => existsSync(join(rt.dataRoot, p))),
    ...['reports', 'interview-prep', 'output'].flatMap(d => walk(rt.dataRoot, d)),
  ];
  const pending = [], synced = [];
  for (const path of [...new Set(files)].sort()) {
    const artifact = artifactFor(path); if (!artifact) continue;
    const hash = fileHash(join(rt.dataRoot, path)), prior = entries[path];
    const item = { path, kind: artifact.kind, target: artifact.target, section: artifact.section, hash, pageId: prior?.pageId ?? null };
    if (prior?.hash === hash) synced.push(item);
    else pending.push({ ...item, reason: prior ? 'changed' : 'new' });
  }
  return { version: 1, pending, synced: synced.length, ledgerEntries: Object.keys(entries).length };
}

/**
 * Record a push to Notion. The reconciliation is recomputed here from the
 * journaled plan (`journal`) and the caller's readback observations, so a push
 * cannot be marked done by passing `{state: 'verified'}`. `hash` is the file
 * hash the pushed body was built from; a later local edit stays pending.
 */
export function recordPush({ path, operationId, receipt = null, observations, hash }, rt) {
  string(path, 'path'); safeId(operationId); string(hash, 'hash of the pushed file'); array(observations, 'readback observations');
  check(artifactFor(path), `Not a synced artifact: ${path}`);
  const plan = readJson(rt, `operations/${operationId}/plan.json`);
  blocked(plan.artifact?.path === path && plan.artifact.hash === hash, 'This operation did not push this file version');
  const result = reconcileOperation(plan, receipt, observations);
  blocked(['verified', 'no_op'].includes(result.state), `Push is recorded only after a verified Notion readback (state: ${result.state})`);
  const pageId = result.pageId ?? plan.pageId;
  blocked(pageId, 'Reconciliation did not identify the Notion page');
  // Even a no-op plan needs a readback showing the intended sections on that page.
  const seen = observations.filter(o => o.pageId?.replaceAll('-', '') === pageId.replaceAll('-', ''));
  blocked(seen.length === 1 && Object.entries(plan.artifact.sectionHashes).every(([k, h]) =>
    typeof seen[0].sections?.[k] === 'string' && contentHash(seen[0].sections[k].replace(/\\:/g, ':')) === h),
  'Readback does not show the pushed sections on that page');
  const file = boundedPath(rt.dataRoot, path); blocked(existsSync(file), `Missing local file: ${path}`);
  blocked(hash === fileHash(file), 'Local file changed after the pushed content was prepared; push again');
  return withLock(rt, 'sync-ledger', () => {
    const all = ledger(rt);
    all[path] = { hash, pageId, operationId, direction: 'push', at: new Date().toISOString() };
    writeJson(rt, LEDGER, all);
    return { path, ...all[path] };
  });
}

function checkPulled(path, text) {
  string(text, `${path} content`);
  if (path === 'cv.md') check(EXPERIENCE.test(text) && /^### +\S/m.test(text), 'cv.md needs a "## Experience" section with "### Company — Location" entries (examples/cv-example.md)');
  if (path === 'modes/_brief.md') check(!/\{[A-Z][^}]*\}/.test(text), '_brief.md still holds template placeholders');
}
function diff(current, proposed) {
  const res = spawnSync('git', ['diff', '--no-index', '--no-color', '--', current, proposed], { encoding: 'utf8', shell: false });
  if (res.error || res.status > 1) return '(diff unavailable: git not found or failed)';
  return res.status === 0 ? '' : res.stdout;
}

/** Stage a Notion → local pull. Nothing in the data root changes until `profileAccept`. */
export function profilePropose({ files, sources }, rt) {
  keys(files, PULL_TARGETS, 'pulled files'); check(Object.keys(files).length > 0, 'Nothing to pull');
  array(sources, 'Notion sources'); check(sources.length > 0, 'A pull needs its Notion sources');
  for (const s of sources) { keys(s, ['id', 'url', 'retrievedAt', 'editedAt'], 'source'); string(s.id, 'source id'); timestamp(s.retrievedAt, 'retrievedAt'); timestamp(s.editedAt ?? null, 'editedAt', true); }
  Object.entries(files).forEach(([p, t]) => checkPulled(p, t));
  const pullId = `pull-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const diffs = {};
  for (const [path, text] of Object.entries(files)) {
    const proposed = boundedPath(rt.stateRoot, `pulls/${pullId}/proposed/${path}`);
    mkdirSync(dirname(proposed), { recursive: true, mode: 0o700 });
    writeFileSync(proposed, text, { flag: 'wx', mode: 0o600 });
    const current = join(rt.dataRoot, path);
    diffs[path] = existsSync(current) ? diff(current, proposed) || '(unchanged)' : '(new file)';
  }
  const before = Object.fromEntries(Object.keys(files).map(p => [p, existsSync(join(rt.dataRoot, p)) ? fileHash(join(rt.dataRoot, p)) : null]));
  writeJson(rt, `pulls/${pullId}/pull.json`, { version: 1, pullId, sources, paths: Object.keys(files), before,
    hashes: Object.fromEntries(Object.entries(files).map(([p, t]) => [p, contentHash(t)])) }, { immutable: true });
  const ledgerNow = ledger(rt);
  const localEdits = Object.keys(files).filter(p => existsSync(join(rt.dataRoot, p)) && ledgerNow[p] && ledgerNow[p].hash !== fileHash(join(rt.dataRoot, p)));
  return { pullId, diffs, localEditsNotInNotion: localEdits };
}

/** Apply a staged pull after the user confirmed the diff; existing files are backed up first. */
export function profileAccept({ pullId, requestRef, paths }, rt) {
  safeId(pullId); string(requestRef, 'Explicit user confirmation reference');
  const pull = readJson(rt, `pulls/${pullId}/pull.json`);
  const chosen = paths ?? pull.paths; array(chosen, 'paths');
  chosen.forEach(p => check(pull.paths.includes(p), `Not part of this pull: ${p}`));
  return withLock(rt, 'sync-ledger', () => {
    blocked(!existsSync(boundedPath(rt.stateRoot, `pulls/${pullId}/accepted.json`)), 'This pull was already accepted; propose a new one');
    const all = ledger(rt), applied = [];
    for (const path of chosen) {
      const target = join(rt.dataRoot, path), now = existsSync(target) ? fileHash(target) : null;
      blocked(now === pull.before[path], `${path} changed locally after the diff was shown; propose again`);
    }
    try {
    for (const path of chosen) {
      const proposed = boundedPath(rt.stateRoot, `pulls/${pullId}/proposed/${path}`);
      blocked(contentHash(readFileSync(proposed, 'utf8')) === pull.hashes[path], `Staged ${path} was modified`);
      const target = boundedPath(rt.dataRoot, path);
      mkdirSync(dirname(target), { recursive: true });
      if (existsSync(target)) {
        const backup = boundedPath(rt.stateRoot, `pulls/${pullId}/backup/${path}`);
        mkdirSync(dirname(backup), { recursive: true, mode: 0o700 }); copyFileSync(target, backup);
      }
      const temp = `${target}.${randomUUID()}.tmp`;
      try { copyFileSync(proposed, temp); renameSync(temp, target); } finally { if (existsSync(temp)) unlinkSync(temp); }
      all[path] = { hash: fileHash(target), sources: pull.sources.map(s => s.id), operationId: pullId, direction: 'pull', requestRef, at: new Date().toISOString() };
      applied.push(path);
    }
    } catch (e) {
      writeJson(rt, LEDGER, all);
      throw new Error(`Pull partly applied (${applied.join(', ') || 'nothing'}); fix the cause and propose again: ${e.message}`);
    }
    writeJson(rt, LEDGER, all);
    writeJson(rt, `pulls/${pullId}/accepted.json`, { pullId, applied, requestRef }, { immutable: true });
    return { pullId, applied };
  });
}
