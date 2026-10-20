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
  return effectiveClaims(s).filter(c => c.status === 'confirmed' && c.evidenceKind !== 'coaching');
}
export function profileHash(s, settings) {
  validateSettings(settings);
  const claims = effectiveClaims(s).sort((a,b) => a.id.localeCompare(b.id));
  const ids = new Set(claims.map(c => c.sourceId));
  const sources = s.sources.filter(x => ids.has(x.id)).map(({ id, contentHash, completeness }) => ({ id, contentHash, completeness })).sort((a,b) => a.id.localeCompare(b.id));
  return contentHash({ claims, sources, settings });
}
export function projectProfile(s, settings) {
  validateSnapshot(s); validateSettings(settings);
  blocked(s.sources.every(x => x.completeness === 'complete'), 'Profile requires complete evidence sources');
  const claims = permittedClaims(s);
  const lines = claims.map(c => `- ${c.value}${c.qualifier ? ` [${c.qualifier}]` : ''} (${c.sourceId} · ${c.locator})`);
  const profileMarkdown = `# ${settings.candidate.name}\n\n${settings.candidate.headline}\n\n${lines.join('\n')}\n`;
  return {
    cvMarkdown: profileMarkdown, profileMarkdown,
    profileYaml: JSON.stringify({
      name: settings.candidate.name, title: settings.candidate.headline,
      location: { needs_sponsorship: settings.sponsorship.required, authorized_in: settings.sponsorship.unrestrictedCountries },
      salary: { minimum: settings.compensation.minimumBaseGBP, currency: 'GBP' },
    }, null, 2),
    briefMarkdown: `${profileMarkdown}\nMinimum annual GBP base: ${settings.compensation.minimumBaseGBP}. Role families: ${settings.roleFamilies.join(', ')}.\n`,
    customMarkdown: '# Personal workflow\n\nRun on-demand only. Present shortlist first; tailor only explicitly selected roles. User submits. Unknown salary/sponsorship require verification. London or UK remote from London; hybrid preferred. Assess attendance, hours, on-call and travel case by case. Never treat an expected promotion as attained.\n',
  };
}
