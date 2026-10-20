/** Versioned, JSON-only contracts. Validation failures are distinct from blocked prerequisites. */
export class InputError extends Error { code = 2; }
export class BlockedError extends Error { code = 3; }
export function check(condition, message) { if (!condition) throw new InputError(message); }
export function blocked(condition, message) { if (!condition) throw new BlockedError(message); }
export function object(value, label) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: expected object`);
}
export function keys(value, allowed, label) {
  object(value, label);
  check(Object.keys(value).every(k => allowed.includes(k)), `${label}: unknown field`);
}
export function string(value, label) { check(typeof value === 'string' && value.trim().length > 0, `${label}: expected nonempty string`); }
export function array(value, label) { check(Array.isArray(value), `${label}: expected array`); }
export function oneOf(value, options, label) { check(options.includes(value), `${label}: invalid value`); }
export function timestamp(value, label, nullable = false) {
  if (nullable && value === null) return;
  string(value, label); check(Number.isFinite(Date.parse(value)), `${label}: invalid timestamp`);
}
export function safeId(value) {
  string(value, 'id'); check(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(value) && !value.includes('..'), 'unsafe id/path');
  return value;
}
export function version(value) { check(value.version === 1, 'unsupported version'); }
export function validateSettings(s) {
  keys(s, ['version','candidate','compensation','sponsorship','location','roleFamilies','cadence','shortlistLimit','preferences'], 'settings');
  version(s);
  object(s.candidate, 'candidate'); string(s.candidate.name, 'candidate name'); string(s.candidate.headline, 'headline');
  object(s.compensation, 'compensation');
  check(Number.isFinite(s.compensation.minimumBaseGBP) && s.compensation.minimumBaseGBP >= 0, 'base floor');
  array(s.compensation.targetBaseGBP, 'target range');
  check(s.compensation.targetBaseGBP.length === 2 && s.compensation.targetBaseGBP.every(Number.isFinite)
    && s.compensation.targetBaseGBP[1] >= s.compensation.targetBaseGBP[0], 'target range');
  object(s.sponsorship, 'sponsorship'); check(typeof s.sponsorship.required === 'boolean', 'sponsorship required');
  check(Number.isFinite(s.sponsorship.months) && s.sponsorship.months >= 0, 'sponsorship months');
  array(s.sponsorship.unrestrictedCountries, 'unrestricted countries');
  object(s.location, 'location');
  for (const k of ['london','ukRemoteFromLondon','hybridPreferred']) check(typeof s.location[k] === 'boolean', `location.${k}`);
  array(s.roleFamilies, 'role families'); s.roleFamilies.forEach(x => string(x, 'role family'));
  oneOf(s.cadence, ['on-demand'], 'cadence');
  check(Number.isInteger(s.shortlistLimit) && s.shortlistLimit > 0 && s.shortlistLimit <= 100, 'shortlist limit');
  return s;
}
