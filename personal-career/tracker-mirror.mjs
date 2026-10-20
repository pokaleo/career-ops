import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { check, blocked, array, keys, string } from './contracts.mjs';
import { boundedPath } from './runtime.mjs';
import { resolveTrackerPath, resolveTrackerPathForWrite } from '../path-resolver.mjs';
import { resolveColumns, parseTrackerRow } from '../tracker-parse.mjs';
import { postingKey } from '../url-key.mjs';

/**
 * Notion is the master tracker; data/applications.md is a local mirror kept so
 * upstream tooling (stats, followup, patterns, calibrate, outcome) keeps working.
 * The mirror is written only through upstream's own writers: new rows as TSV +
 * merge-tracker.mjs, status changes through set-status.mjs.
 */
export const STAGE_TO_STATE = {
  Wishlist: 'Evaluated', Preparing: 'Evaluated', Applied: 'Applied', 'Recruiter Screen': 'Responded',
  'Technical Interview': 'Interview', 'Hiring Manager': 'Interview', 'Final Interview': 'Interview', 'On Hold': 'Interview',
  Offer: 'Offer', Accepted: 'Hired', Rejected: 'Rejected', Withdrawn: 'Discarded',
};
const TRACKER_HEADER = '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |\n|---|------|---------|------|-------|--------|-----|--------|-------|-----|\n';

const pageKey = id => id.replaceAll('-', '').toLowerCase();
const marker = id => `notion:${pageKey(id)}`;
const slug = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'role';
const cell = v => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();

function validateRecord(r) {
  keys(r, ['pageId', 'company', 'position', 'stage', 'url', 'score', 'date', 'reportNumber', 'reportPath', 'pdf', 'notes'], 'tracker record');
  for (const k of ['pageId', 'company', 'position', 'stage']) string(r[k], `record.${k}`);
  check(STAGE_TO_STATE[r.stage], `Unmapped Notion stage: ${r.stage}`);
  if (r.score !== undefined && r.score !== null) check(Number.isFinite(r.score) && r.score >= 0 && r.score <= 5, 'record.score');
  if (r.reportPath) check(/^reports\/\d{3,4}-[^/]+\.md$/.test(r.reportPath), 'record.reportPath');
  return r;
}

function localRows(dataRoot) {
  const file = resolveTrackerPath(dataRoot);
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split('\n'), colmap = resolveColumns(lines);
  return lines.map(l => parseTrackerRow(l, colmap)).filter(Boolean);
}
/** Strongest local evidence first: the Notion marker, then the report, then the posting key. */
function findRow(rows, r) {
  const byMarker = rows.filter(row => row.notes.includes(marker(r.pageId)));
  if (byMarker.length) return byMarker;
  const fromPath = r.reportPath?.match(/^reports\/(\d+)/)?.[1];
  const reportNum = r.reportNumber ?? fromPath;
  const num = reportNum ? parseInt(reportNum, 10) : null;
  const byReport = num ? rows.filter(row => new RegExp(`\\[0*${num}\\]\\(`).test(row.report)) : [];
  if (byReport.length) return byReport;
  const key = r.url ? postingKey(r.url) : '';
  return key ? rows.filter(row => row.url && postingKey(row.url) === key) : [];
}

export function planMirror(records, rows) {
  array(records, 'records');
  const additions = [], updates = [], unchanged = [], conflicts = [], invalid = [];
  for (const raw of records) {
    let r;
    try { r = validateRecord(raw); } catch (e) { invalid.push({ pageId: raw?.pageId ?? null, error: e.message }); continue; }
    const state = STAGE_TO_STATE[r.stage], found = findRow(rows, r);
    if (found.length > 1) { conflicts.push({ pageId: r.pageId, rows: found.map(x => x.num) }); continue; }
    if (!found.length) { additions.push({ record: r, state }); continue; }
    // Only the Notion marker is mirrored into Notes: the stage itself lives in Notion,
    // so a stage note here would go stale on the next move.
    const row = found[0], notes = row.notes.includes(marker(r.pageId)) ? [] : [marker(r.pageId)];
    if (row.status === state && !notes.length) unchanged.push({ pageId: r.pageId, row: row.num });
    else updates.push({ pageId: r.pageId, row: row.num, from: row.status, state, notes });
  }
  return { additions, updates, unchanged, conflicts, invalid };
}

function tsvFor({ record: r, state }, num, today) {
  const report = r.reportPath ? `[${r.reportPath.match(/^reports\/(\d+)/)[1]}](${r.reportPath})` : '—';
  const notes = [marker(r.pageId), r.notes].filter(Boolean).map(cell).join('; ');
  const header = ['num', 'date', 'company', 'role', 'status', 'score', 'pdf', 'report', 'notes', 'url'];
  const values = [num, r.date ?? today, cell(r.company), cell(r.position), state,
    Number.isFinite(r.score) ? `${r.score.toFixed(1)}/5` : 'N/A', r.pdf ? '✅' : '❌', report, notes, r.url ?? ''];
  return `${header.join('\t')}\n${values.join('\t')}\n`;
}

/**
 * Apply a Notion → local mirror. Rows with a report reuse its number; rows
 * without one get a number from reserve-report-num.mjs so the tracker never
 * computes max+1 on its own (#749).
 */
export function mirrorTracker({ records, apply = false, today = new Date().toISOString().slice(0, 10) }, rt, runner = spawnSync) {
  const plan = planMirror(records, localRows(rt.dataRoot));
  if (!apply) return { applied: false, ...plan };
  blocked(!plan.conflicts.length, 'Several local rows match one Notion page; resolve them before mirroring');
  blocked(!plan.invalid.length, `Notion records need fixing before mirroring: ${plan.invalid.map(i => `${i.pageId}: ${i.error}`).join('; ')}`);
  const env = { ...process.env, CAREER_OPS_ROOT: rt.dataRoot, CAREER_OPS_DATA_DIR: rt.dataRoot };
  const node = (script, args) => {
    const res = runner(process.execPath, [join(rt.repoRoot, script), ...args], { cwd: rt.repoRoot, env, encoding: 'utf8', shell: false, timeout: 120000 });
    blocked(res.status === 0, `${script} failed: ${(res.stderr || res.stdout || res.error?.message || '').trim().slice(0, 500)}`);
    return res.stdout;
  };
  const trackerFile = resolveTrackerPathForWrite(rt.dataRoot);
  if (!existsSync(trackerFile)) { mkdirSync(dirname(trackerFile), { recursive: true }); writeFileSync(trackerFile, TRACKER_HEADER, { flag: 'wx' }); }
  const results = [], failures = [], written = [];
  if (plan.additions.length) {
    const unnumbered = plan.additions.filter(a => !a.record.reportPath);
    const reserved = unnumbered.length ? node('reserve-report-num.mjs', ['--count', String(unnumbered.length)]).trim() : null;
    const [lo] = reserved ? reserved.split('-').map(n => parseInt(n, 10)) : [0];
    try {
      unnumbered.forEach((a, i) => { a.num = lo + i; });
      for (const a of plan.additions) {
        const num = a.num ?? parseInt(a.record.reportPath.match(/^reports\/(\d+)/)[1], 10);
        const file = boundedPath(rt.dataRoot, `batch/tracker-additions/${String(num).padStart(3, '0')}-${slug(a.record.company)}.tsv`);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, tsvFor(a, num, today), { flag: 'wx' });
        written.push(file);
        results.push({ pageId: a.record.pageId, added: num });
      }
      node('merge-tracker.mjs', []);
    } catch (e) {
      // Unmerged TSVs would carry numbers released below; remove them so a re-run starts clean.
      for (const f of written) if (existsSync(f)) unlinkSync(f);
      throw e;
    } finally {
      if (reserved) node('reserve-report-num.mjs', ['--release', reserved]);
    }
  }
  for (const u of plan.updates) {
    const args = ['--row', String(u.row), u.state, '--json'];
    if (u.notes.length) args.push(`--note=${u.notes.join('; ')}`);
    // One refused transition (e.g. Notion behind a local state) must not stop the rest.
    try { node('set-status.mjs', args); results.push({ pageId: u.pageId, updated: u.row, state: u.state }); }
    catch (e) { failures.push({ pageId: u.pageId, row: u.row, state: u.state, error: e.message }); }
  }
  return { applied: true, ...plan, results, failures, conflicts: [...plan.conflicts, ...failures] };
}
