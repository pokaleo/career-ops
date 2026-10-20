import { check, keys, string, array, oneOf, timestamp, version, validateSettings, blocked } from './contracts.mjs';
import { contentHash } from './runtime.mjs';

export function validateSnapshot(s) {
  keys(s, ['version','runId','retrievedAt','schema','sources','claims','records','identityIndexComplete'], 'snapshot');
  version(s); string(s.runId, 'run ID'); timestamp(s.retrievedAt, 'retrievedAt');
  keys(s.schema, ['dataSourceId','fingerprint','properties'], 'schema');
  string(s.schema.dataSourceId, 'data source'); string(s.schema.fingerprint, 'schema fingerprint');
  check(s.schema.properties && typeof s.schema.properties === 'object', 'schema properties');
  array(s.sources, 'sources'); array(s.claims, 'claims'); array(s.records, 'records');
  check(typeof s.identityIndexComplete === 'boolean', 'identity index completeness');
  const sources = new Map(), claims = new Map();
  for (const source of s.sources) {
    keys(source, ['id','url','kind','content','contentHash','sourceEditedAt','retrievedAt','completeness'], 'source');
    for (const k of ['id','url','kind','contentHash']) string(source[k], `source.${k}`);
    check(!sources.has(source.id), 'duplicate source ID');
    check(typeof source.content === 'string' && contentHash(source.content) === source.contentHash, 'source content hash mismatch');
    timestamp(source.sourceEditedAt, 'source edit time', true); timestamp(source.retrievedAt, 'source retrieval time');
    oneOf(source.completeness, ['complete','partial','unavailable'], 'source completeness'); sources.set(source.id, source);
  }
  for (const c of s.claims) {
    keys(c, ['id','key','value','qualifier','sourceId','locator','evidenceKind','status','writeDisposition','supersedes'], 'claim');
    for (const k of ['id','key','value','sourceId','locator']) string(c[k], `claim.${k}`);
    check(!claims.has(c.id), 'duplicate claim ID'); check(sources.has(c.sourceId), 'claim references missing source');
    oneOf(c.evidenceKind, ['user_statement','employer_feedback','interviewer_feedback','repository_analysis','credential_record','prior_cv','coaching'], 'evidence kind');
    oneOf(c.status, ['confirmed','reported','inferred','unresolved'], 'claim status');
    oneOf(c.writeDisposition, ['allowed','deferred'], 'write disposition');
    if (c.qualifier !== undefined) string(c.qualifier, 'qualifier');
    array(c.supersedes, 'supersedes'); claims.set(c.id, c);
  }
  const visited = new Set(), visiting = new Set();
  function visit(id) {
    check(claims.has(id), 'supersedes references missing claim'); check(!visiting.has(id), 'supersession cycle');
    if (visited.has(id)) return;
    visiting.add(id); claims.get(id).supersedes.forEach(visit); visiting.delete(id); visited.add(id);
  }
  [...claims.keys()].forEach(visit);
  return s;
}
export function effectiveClaims(s) {
  validateSnapshot(s);
  const superseded = new Set(s.claims.flatMap(c => c.supersedes));
  return s.claims.filter(c => !superseded.has(c.id));
}
export function permittedClaims(s) {
  return candidateClaims(s).filter(c => c.status === 'confirmed' && c.evidenceKind !== 'coaching');
}
export function candidateClaims(s) {
  return effectiveClaims(s).filter(c => !c.key.startsWith('application:'));
}
export function profileHash(s, settings) {
  validateSettings(settings);
  const claims = candidateClaims(s).sort((a,b) => a.id.localeCompare(b.id));
  const ids = new Set(claims.map(c => c.sourceId));
  const sources = s.sources.filter(x => ids.has(x.id)).map(({ id, contentHash, completeness }) => ({ id, contentHash, completeness })).sort((a,b) => a.id.localeCompare(b.id));
  return contentHash({ claims, sources, settings });
}
const FAMILY_LABELS = { 'applied-ai': 'Applied AI Engineer', 'ai-product': 'AI Product Engineer / Manager', 'forward-deployed': 'Forward Deployed Engineer',
  'architect-lead': 'AI / Solutions Architect or Tech Lead', 'backend-platform': 'Backend / Platform Engineer' };
const gbp = n => `£${Number(n).toLocaleString('en-GB')}`;
/**
 * Upstream-compatible projections of confirmed evidence. cv.md is NOT projected:
 * it is pulled from the Notion CV source (see `profile-propose`) so it keeps the
 * structure upstream's CV checks read. Write these only through profile-propose.
 */
export function projectProfile(s, settings) {
  validateSnapshot(s); validateSettings(settings);
  blocked(s.sources.every(x => x.completeness === 'complete'), 'Profile requires complete evidence sources');
  const claims = permittedClaims(s);
  const lines = claims.map(c => `- ${c.value}${c.qualifier ? ` [${c.qualifier}]` : ''} (${c.sourceId} · ${c.locator})`);
  const claimsMarkdown = `## Confirmed evidence (from Notion)\n\n${lines.join('\n')}\n`;
  const { compensation: comp, sponsorship: sp, location: loc } = settings;
  const where = [loc.london && 'London', loc.ukRemoteFromLondon && 'UK remote (workable from London)'].filter(Boolean).join(' or ');
  const briefMarkdown = [
    `# ${settings.candidate.name} — Triage Brief`, '',
    '## Identity', `${settings.candidate.headline}. ${where}${loc.hybridPreferred ? ', hybrid preferred' : ''}. ${sp.required ? `Needs visa sponsorship for a new employer (~${sp.months} months).` : 'No sponsorship needed.'}`, '',
    '## Target Archetypes', '| # | Archetype | What they buy (your proof) |', '|---|-----------|----------------------------|',
    ...settings.roleFamilies.map((f, i) => `| ${i + 1} | **${FAMILY_LABELS[f] ?? f}** | see Proof Points |`), '',
    '## Proof Points (use exact metrics in matching)', ...lines, '',
    '## Comp Strategy', '| Target | Requirement |', '|--------|-------------|',
    `| ${gbp(comp.targetBaseGBP[0])}–${gbp(comp.targetBaseGBP[1])}+ | annual base; bonus, equity and OTE are separate |`, '',
    `**Hard floor: ${gbp(comp.minimumBaseGBP)} annual base. Below that, FAIL regardless of other signals.**`, '',
    '## Location Scoring', `- ${where} → **5.0**`, '- Attendance, travel, hours and on-call → judged case by case, never a hidden exclusion', '- Outside London and not UK-remote → **FAIL**', '',
    '## Hard DQ Criteria — instant FAIL (< 3.0)',
    `- Stated annual base ceiling below ${gbp(comp.minimumBaseGBP)} (bonus/OTE never counts toward base)`,
    ...(sp.required ? ['- Employer states it will not sponsor a visa (unknown sponsorship is a verify flag, not a fail)'] : []),
    '- Role cannot be done from London or UK remote', '',
  ].join('\n');
  return {
    claimsMarkdown, briefMarkdown,
    profileYaml: JSON.stringify({
      candidate: { full_name: settings.candidate.name, title: settings.candidate.headline },
      location: { needs_sponsorship: sp.required, authorized_in: sp.unrestrictedCountries,
        visa_status: sp.required ? `Sponsorship required for a new employer; planning need ${sp.months} months. Existing permission does not establish unrestricted new-employer rights.` : 'Sponsorship not required according to current candidate settings.' },
      compensation: { minimum: `${gbp(comp.minimumBaseGBP)} annual base`, currency: 'GBP',
        target_range: `${gbp(comp.targetBaseGBP[0])}–${gbp(comp.targetBaseGBP[1])} annual base; higher welcome; bonus and equity separate` },
      target_roles: { primary: settings.roleFamilies.map(f => FAMILY_LABELS[f] ?? f) },
      // Above the 5.0 maximum: pipeline/batch never tailor a CV before selection.
      auto_pdf_score_threshold: 5.1,
    }, null, 2),
  };
}
