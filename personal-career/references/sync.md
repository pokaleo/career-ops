# Notion ↔ local sync

Notion is the master store. The data root (`career-data/`) is a local mirror, so that upstream modes read their usual in-scope files and every artifact also exists on disk. Every pull and verified push is recorded in `data/personal-career/sync/ledger.json`.

## Pull (start of every run)

1. **Profile facts.** Fetch the Notion career profile and the current CV source (the newest CV Library version the user maintains, or the profile page's CV). Write their content as:
   - `cv.md` — in the shape `examples/cv-example.md` uses (`## Experience`, `### Company — Location`, a bold title line, a dates line, skills under a "Skills" heading). Restate; never add facts.
   - `article-digest.md` for detailed proof points, `modes/_profile.md` for archetypes, narrative and targeting.
   - `config/profile.yml` and `modes/_brief.md` from `profile` (the projection of confirmed claims and settings).
2. `profile-propose` with those files and their Notion sources. It validates the structure, stages the files, and returns a unified diff per file. It also lists `localEditsNotInNotion`: files changed locally since the last sync. Push those first (below) or ask the user which side wins.
3. Show the user the diff. Only after they confirm, run `profile-accept` with that confirmation's reference (optionally only some `paths`). Existing files are backed up under `pulls/<pullId>/backup/`. Skip the pull when nothing changed.
4. **Tracker.** Normalise the paginated Applications records to `{pageId, company, position, stage, url, score, date, reportPath}` and run `mirror-tracker` (dry run first; `apply: true` to write). It adds rows through TSV + `merge-tracker.mjs` and changes status through `set-status.mjs`, matching rows by the `notion:<pageId>` note, then by report number, then by posting key. Several local rows matching one page is a conflict to resolve by hand.

## Push (end of every run)

`sync-status` lists every local artifact whose content is not in Notion yet:

| Local file | Notion target |
|---|---|
| `reports/NNN-*.md` | application page, `career-workflow` section |
| `interview-prep/{company}-{role}.md`, `interview-prep/sessions/*.md` | application page, `career-workflow-interview` |
| `data/follow-ups.md` | each application's `career-workflow-followups` |
| `output/*` (CV, cover letter) | new CV Library record linked to the application |
| `interview-prep/story-bank.md` | profile page, `career-workflow-story-bank` |
| `cv.md`, `article-digest.md` edited locally (for example by upstream `add` / `expand`) | profile page, `career-workflow-cv`, for the user to merge into the profile |

Push each through the [Notion protocol](notion.md), then `record-push` with its operation ID, readback observations and the hash `sync-status` reported. An unverified push stays pending. `data/applications.md` is never pushed: Notion's Stage is the source and the local file is its mirror.

## Offline

Without Notion access, say so. Work from the mirror, label results with the last ledger date, and leave every new artifact pending. The next run pushes it.
