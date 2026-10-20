import { createHash, randomUUID } from 'node:crypto';
import { existsSync, realpathSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, rmdirSync } from 'node:fs';
import { resolve, relative, dirname, join, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
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
export function resolveRuntime({ repoRoot = dirname(dirname(fileURLToPath(import.meta.url))), dataRoot } = {}) {
  repoRoot = canonicalPath(repoRoot);
  dataRoot = canonicalPath(dataRoot ?? getCareerOpsRoot());
  check(!inside(repoRoot, dataRoot), 'Private data root must be outside the checkout');
  const stateRoot = canonicalPath(join(dataRoot, 'data', 'personal-career'));
  check(inside(dataRoot, stateRoot) && !inside(repoRoot, stateRoot), 'Invalid state path');
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
