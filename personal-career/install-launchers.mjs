#!/usr/bin/env node
// Writes the thin CLI launchers that point at personal-career/SKILL.md.
//   node personal-career/install-launchers.mjs [--dry-run] [--only claude|codex]
// Claude: <checkout>/.claude/skills/personal-career/SKILL.md — git-ignored, because
//   upstream owns .claude/skills/ and config/local-paths.txt cannot claim it.
// Codex:  $CODEX_HOME/skills/personal-career/SKILL.md (default ~/.codex), user scope.
// Re-run after moving the checkout or the data root; launchers hold no logic.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { homedir } from 'node:os';
import { resolveRuntime, gitIgnored } from './runtime.mjs';

const args = process.argv.slice(2), dryRun = args.includes('--dry-run');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
if (only !== null && !['claude', 'codex'].includes(only)) { process.stderr.write('--only takes claude or codex\n'); process.exit(2); }
const rt = resolveRuntime();
const description = 'Use when the user asks to find or evaluate jobs, tailor selected applications, prepare for interviews, review job-hunt follow-ups, or sync career data with Notion.';

function launcher(skillPath, dataRoot) {
  return `---
name: personal-career
description: ${description}
---

Read the protected source skill at \`${skillPath}\` and the private setup at \`${dataRoot}/setup.md\`, then follow the applicable procedure. Resolve relative references from that source directory.

If either path is unavailable, report the missing setup and stop dependent work. Never fall back to career-ops auto-pipeline for a pasted JD: evaluate it, but generate no CV, cover letter or answers until the user explicitly selects the role. Notion is the master store; refresh from it before acting and push results back after. The user submits applications.
`;
}

const targets = [
  { cli: 'claude', file: join(rt.repoRoot, '.claude', 'skills', 'personal-career', 'SKILL.md'),
    body: launcher('personal-career/SKILL.md', relative(rt.repoRoot, rt.dataRoot) || '.') },
  { cli: 'codex', file: join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills', 'personal-career', 'SKILL.md'),
    body: launcher(join(rt.repoRoot, 'personal-career', 'SKILL.md'), rt.dataRoot) },
].filter(t => !only || t.cli === only);

const report = [];
for (const t of targets) {
  if (t.cli === 'claude' && !gitIgnored(rt.repoRoot, t.file)) {
    report.push({ cli: t.cli, file: t.file, skipped: 'not git-ignored; add /.claude/skills/personal-career/ to .gitignore' });
    continue;
  }
  const prior = existsSync(t.file) ? readFileSync(t.file, 'utf8') : null;
  if (prior === t.body) { report.push({ cli: t.cli, file: t.file, unchanged: true }); continue; }
  if (!dryRun) {
    mkdirSync(dirname(t.file), { recursive: true });
    if (prior !== null) copyFileSync(t.file, `${t.file}.bak`);
    writeFileSync(t.file, t.body);
  }
  report.push({ cli: t.cli, file: t.file, written: !dryRun, backup: prior !== null ? `${t.file}.bak` : null });
}
process.stdout.write(`${JSON.stringify({ dryRun, repoRoot: rt.repoRoot, dataRoot: rt.dataRoot, launchers: report }, null, 2)}\n`);
if (report.some(r => r.skipped)) process.exitCode = 3;
