import { createHash, randomUUID } from 'node:crypto';
import { existsSync, realpathSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, rmdirSync } from 'node:fs';
import { resolve, relative, dirname, join, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { check, blocked, safeId } from './contracts.mjs';

export function canonicalPath(path) {
  const absolute = resolve(path);
  if (existsSync(absolute)) return realpathSync(absolute);
  const parent = dirname(absolute);
  return parent === absolute ? absolute : join(canonicalPath(parent), relative(parent, absolute));
}
export function inside(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}
/** True when git would never stage `path`: it is ignored and nothing under it is tracked. */
export function gitIgnored(repoRoot, path) {
  const run = args => spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', shell: false });
  if (run(['check-ignore', '-q', '--', path]).status !== 0) return false;
  const tracked = run(['ls-files', '--', path]);
  return tracked.status === 0 && tracked.stdout.trim() === '';
}
/**
 * A data root inside the checkout is accepted only when git ignores the whole
 * folder. The probe is a sentinel directly under the data root: upstream's
 * unanchored user-layer rules (`cv.md`, `data/*`) would match a probe like
 * foo/cv.md while foo/reports/ or foo/output/ stay stageable. The checkout
 * root itself is refused — use a subfolder such as career-data/.
 */
export function resolveRuntime({ repoRoot = dirname(dirname(fileURLToPath(import.meta.url))), dataRoot } = {}) {
  repoRoot = canonicalPath(repoRoot);
  dataRoot = canonicalPath(dataRoot ?? getCareerOpsRoot());
  const stateRoot = canonicalPath(join(dataRoot, 'data', 'personal-career'));
  check(inside(dataRoot, stateRoot), 'Invalid state path');
  if (inside(repoRoot, dataRoot)) {
    check(dataRoot !== repoRoot && gitIgnored(repoRoot, join(dataRoot, '.personal-career-probe')),
      'Data root inside the checkout must be a git-ignored subfolder (add it to .gitignore)');
  }
  return { repoRoot, dataRoot, stateRoot };
}
export function boundedPath(root, path) {
  check(typeof path === 'string' && path.length > 0 && !isAbsolute(path)
    && !path.split(/[\\/]/).includes('..'), 'Invalid relative path');
  const result = canonicalPath(join(root, path));
  check(inside(canonicalPath(root), result), 'Path escapes private root');
  return result;
}
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  check(value === null || ['string','boolean','number'].includes(typeof value), 'Non-JSON value');
  check(typeof value !== 'number' || Number.isFinite(value), 'Nonfinite number');
  return JSON.stringify(value);
}
export const contentHash = value => createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
export function writeJson(rt, name, value, { immutable = false } = {}) {
  const file = boundedPath(rt.stateRoot, name), data = `${canonicalJson(value)}\n`;
  if (immutable && existsSync(file)) {
    blocked(contentHash(readJson(rt, name)) === contentHash(value), `Immutable file differs: ${name}`);
    return file;
  }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, data, { flag: 'wx', mode: 0o600 });
    renameSync(temp, file);
  } finally { if (existsSync(temp)) unlinkSync(temp); }
  return file;
}
export const readJson = (rt, name) => JSON.parse(readFileSync(boundedPath(rt.stateRoot, name), 'utf8'));
/** Synchronous callback only: all helpers are local/synchronous; connector IO stays outside locks. */
export function withLock(rt, id, fn) {
  const path = boundedPath(rt.stateRoot, `locks/${safeId(id)}.lock`);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try { mkdirSync(path, { mode: 0o700 }); } catch (e) { if (e.code === 'EEXIST') blocked(false, `Writer locked: ${id}`); throw e; }
  try {
    const result = fn();
    check(!result?.then, 'Lock callback must be synchronous');
    return result;
  } finally { rmdirSync(path); }
}
