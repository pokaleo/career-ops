import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { check, blocked, string } from './contracts.mjs';
import { boundedPath, contentHash } from './runtime.mjs';

/**
 * Bridge between upstream `oferta` reports (reports/NNN-*.md, the human-facing
 * artifact) and this workflow's validated assessments. The report stays the
 * primary output; the personal section is inserted between literal markers so
 * re-running `report-attach` replaces only what this workflow owns.
 */
export const SECTION_START = '<!-- personal-career:start -->';
export const SECTION_END = '<!-- personal-career:end -->';
const JD_HEADING = /^## Job Description \(archived verbatim\)\s*$/m;

const header = (md, label) => md.match(new RegExp(`^\\*\\*${label}:\\*\\*[ \\t]*(.*)$`, 'mi'))?.[1].trim() ?? null;
function machineSummary(md) {
  const block = md.match(/^## Machine Summary\s*\n+```ya?ml\n([\s\S]*?)\n```/m)?.[1] ?? '';
  const field = k => block.match(new RegExp(`^${k}:[ \\t]*(.*)$`, 'm'))?.[1].trim().replace(/^["']|["']$/g, '') ?? null;
  return { score: field('score'), confidence: field('confidence'), decision: field('final_decision') };
}
function archivedJd(md) {
  const m = JD_HEADING.exec(md);
  if (!m) return null;
  const rest = md.slice(m.index + m[0].length);
  // A verbatim JD may carry its own `## ` headings; stop only at report sections.
  const next = rest.search(/^## (?:Cover Letter Draft|Keywords extracted|Keyword Coverage|[A-HP]\) )/mi);
  const body = (next === -1 ? rest : rest.slice(0, next)).replace(SECTION_START, '').trim();
  return body || null;
}
export const isJdPointer = text => /^See jds\/\S+ for the full archive \(archive-posting\.mjs --report=\d+\)\.$/.test(text ?? '');
const scoreValue =v => { const m = String(v ?? '').match(/^(\d(?:\.\d+)?)(?:\/5)?$/); return m ? Number(m[1]) : null; };
const cap = v => v ? v[0].toUpperCase() + v.slice(1).toLowerCase() : null;

export function parseReport(rt, reportPath) {
  string(reportPath, 'report path');
  check(/^reports\/\d{3,4}-[^/]+\.md$/.test(reportPath), 'report path must be reports/NNN-*.md');
  const file = boundedPath(rt.dataRoot, reportPath);
  blocked(existsSync(file), `Report missing: ${reportPath}`);
  const md = readFileSync(file, 'utf8');
  const summary = machineSummary(md);
  const headerScore = scoreValue(header(md, 'Score')), summaryScore = scoreValue(summary.score);
  check(headerScore !== null, 'Report header has no X/5 score');
  check(summaryScore === null || summaryScore === headerScore, 'Report header and Machine Summary scores differ');
  const jd = archivedJd(md);
  blocked(!isJdPointer(jd), 'Report points to a jds/ capture; archive the JD text verbatim in the report');
  const title = md.match(/^# Evaluation:\s*(.+?)\s+(?:—|--|-)\s+(.+)$/m);
  return {
    reportPath, reportNumber: reportPath.match(/^reports\/(\d{3,4})-/)[1],
    company: title?.[1] ?? null, title: title?.[2] ?? null,
    url: header(md, 'URL') || null, score: headerScore,
    confidence: cap(summary.confidence), decision: header(md, 'Decision') ?? summary.decision,
    legitimacy: header(md, 'Legitimacy'), jdText: jd, hash: contentHash(md),
  };
}

const esc = v => String(v).replace(/\|/g, '\\|').replace(/\n+/g, ' ');
export function renderPersonalSection(assessment, job) {
  const e = assessment.eligibility;
  const lines = [
    SECTION_START,
    '## P) Personal Fit — eligibility gates and evidence',
    '',
    `**Fit:** ${assessment.fit} (${assessment.score}/5, ${assessment.confidence} confidence)`,
    `**Eligibility:** ${e.status}${e.blockers.length ? ` — blockers: ${e.blockers.join(', ')}` : ''}${e.unknowns.length ? ` — verify: ${e.unknowns.join(', ')}` : ''}`,
    `**Job ID:** \`${job.id}\`${job.pageId ? ` · Notion page \`${job.pageId}\`` : ''}`,
    '',
    assessment.rationale,
    '',
    '| Dimension | Assessment |', '|---|---|',
    ...Object.entries(assessment.dimensions).map(([k, v]) => `| ${k} | ${esc(v)} |`),
    '',
    '| Claim | JD evidence | Why it matches |', '|---|---|---|',
    ...assessment.matches.map(m => `| \`${m.claimId}\` | "${esc(m.jdEvidence)}" | ${esc(m.explanation)} |`),
    '',
    '**Gaps:**',
    ...(assessment.gaps.length ? assessment.gaps.map(g => `- ${g.detail} ([source](${g.sourceUrl}))`) : ['- none recorded']),
    '',
    `**Positioning (applies only after selection):** ${assessment.positioning}`,
    SECTION_END,
  ];
  return lines.join('\n');
}

/** Insert or replace the personal section just before the archived JD (or at the end). */
export function attachSection(md, section) {
  const start = md.indexOf(SECTION_START), end = md.indexOf(SECTION_END);
  check((start === -1) === (end === -1) && md.indexOf(SECTION_START, start + 1) === -1, 'Report has broken or duplicate personal-career markers');
  if (start !== -1) return md.slice(0, start) + section + md.slice(end + SECTION_END.length);
  const m = JD_HEADING.exec(md);
  return m ? `${md.slice(0, m.index)}${section}\n\n${md.slice(m.index)}` : `${md.trimEnd()}\n\n${section}\n`;
}

export function writeReportSection(rt, reportPath, assessment, job) {
  const file = boundedPath(rt.dataRoot, reportPath);
  const next = attachSection(readFileSync(file, 'utf8'), renderPersonalSection(assessment, job));
  const temp = `${file}.${randomUUID()}.tmp`;
  try { writeFileSync(temp, next, { flag: 'wx' }); renameSync(temp, file); }
  finally { if (existsSync(temp)) unlinkSync(temp); }
  return { reportPath, hash: contentHash(next) };
}
