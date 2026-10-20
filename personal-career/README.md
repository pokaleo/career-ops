# personal-career — this fork's workflow on top of career-ops

This fork of [santifer/career-ops](https://github.com/santifer/career-ops) adds a personal workflow layer. Upstream still does the work: scanning, liveness checks, `oferta` evaluations, CV rendering, interview prep and follow-up cadence. This layer adds four things:

- **Notion as the master store.** The profile, tracker, CV library, reports, interview prep and follow-ups all live in Notion. The in-project data root `career-data/` is a local mirror.
- **Shortlist first.** A pasted JD or scan hit is evaluated and recorded, and nothing is tailored until you explicitly select the role. The selection is bound to hashes of your profile and the JD.
- **Combined fit.** The upstream 1–5 score, plus a Strong / Moderate / Stretch band, UK eligibility gates (GBP annual base, visa sponsorship, London / UK-remote), and match evidence that cites claim IDs.
- **Combined identity.** Upstream's posting key (aggregator IDs, hash routes), the ATS requisition, the Notion page and the report number.

The root `README.md`, `AGENTS.md` and `modes/` are upstream's and are replaced on every update. Fork documentation lives here.

## Layout

| Path | What it is | In git |
|---|---|---|
| `personal-career/` | this layer: skill, procedures, helpers, tests | yes; protected from upstream updates by `config/local-paths.txt` |
| `career-data/` | data root: `cv.md`, `config/`, `modes/_profile.md`, `_brief.md`, `_custom.md`, `portals.yml`, `data/`, `reports/`, `output/`, `jds/`, `interview-prep/` | **no** (git-ignored) |
| `career-data/data/personal-career/` | workflow state: runs, selections, materials, Notion operation journal, identity bindings, sync ledger, pulls | no |
| `career-data/data/personal-career/archive/2026-10-20-codex-build/` | the original Codex build: raw Notion dumps, logs, design and runbook | no |
| `.career-ops-data` | marker containing `career-data`; upstream's path resolver reads it, so every script uses the in-project data root | no |
| `.claude/skills/personal-career/SKILL.md` | Claude Code launcher, generated | no (upstream owns `.claude/skills/`) |
| `~/.codex/skills/personal-career/SKILL.md` | Codex launcher, generated | outside the repo |

The runtime refuses a data root inside the checkout unless git ignores both `cv.md` and the workflow state.

## Setup (once per machine)

1. **Node** `^22.13 || >=23.4`, then `npm install --ignore-scripts`. Optional: `npx playwright install chromium` (PDF rendering and the liveness browser fallback), `node install-latex-engine.mjs` (LaTeX CVs).
2. **Data root:** `echo career-data > .career-ops-data`, then restore or create `career-data/` (it is not in git; back it up yourself). `/career-data/` and `/.claude/skills/personal-career/` are already in `.gitignore`.
3. **Notion connector:**
   - Claude Code: `claude mcp add --transport http --scope user notion https://mcp.notion.com/mcp`, then run `/mcp` in a session and authorise your workspace.
   - Codex: enable the Notion app.
   - No API token is stored anywhere.
4. **Launchers:** `node personal-career/install-launchers.mjs` (`--dry-run` to preview, `--only claude|codex`). Re-run it after moving the checkout or the data root.
5. **Private config** in `career-data/config/`:
   - `personal-career.json`: settings — `candidate`, `compensation.minimumBaseGBP` / `targetBaseGBP`, `sponsorship.{required,months,unrestrictedCountries}`, `location.{london,ukRemoteFromLondon,hybridPreferred}`, `roleFamilies`, `cadence: "on-demand"`, `shortlistLimit` (1–100), `preferences`.
   - `notion.json`: `profilePage`, `applications` (data source), `trackerPage`, `cvLibrary`, `currentSnapshot`, `deferredCorrections`.
6. **Check:** `node doctor.mjs`, `node personal-career/test.mjs`.

The Applications database needs: Company (title), Position, Stage (status: Wishlist, Preparing, Applied, Recruiter Screen, Technical Interview, Hiring Manager, Final Interview, On Hold, Offer, Accepted, Rejected, Withdrawn), Fit (select), Score (number), CV Version (relation to the CV library), plus the optional fields in `references/notion.md`.

## Using it

Ask in Claude Code or Codex, inside this repo: "use personal-career to …".

| You say | What happens |
|---|---|
| "find me roles" | refresh from Notion → `scan.mjs` + web search → `check-liveness` → `oferta` reports → personal fit section → Notion Wishlist → shortlist |
| paste a JD or link | the same for one role; no CV is generated |
| "I select X and Y" | `select` → Notion Preparing → upstream `pdf` / `cover` / `apply` gated by `materials-check` → verified PDF → CV Library version |
| "prepare me for the X interview" | upstream `interview-prep` / `interview/*` against the actually submitted CV → pushed to the application page |
| "what should I follow up?" | upstream `followup` cadence + confirmed events → drafts only → pushed after you confirm |
| "I applied to X" / "X rejected me" | confirmed event → Notion Stage → `mirror-tracker` → `set-status` |
| "sync" | pull profile diffs (you confirm) + tracker mirror, then push everything `sync-status` lists |

The house rules that make upstream modes behave this way live in `career-data/modes/_custom.md` (Evaluation and Pipeline Rules). Upstream supports overriding defaults there, and updates never touch it. `config/profile.yml` sets `auto_pdf_score_threshold: 5.1`, so `pipeline` and `batch` never tailor before selection either.

## Helper commands

`node personal-career/cli.mjs COMMAND input.json` (or `-` for stdin). JSON goes to stdout, diagnostics to stderr. Exit codes: 0 ok, 2 invalid input, 3 blocked / conflict / pending. `dataRoot` in the input is optional; the marker is used otherwise. The helpers never call the network: the agent does the Notion and web IO, and the helpers validate it.

| Command | Input | Purpose |
|---|---|---|
| `profile` | `snapshot`, `settings` | project confirmed claims into `profileYaml`, `briefMarkdown`, `claimsMarkdown` |
| `profile-propose` | `files` (`cv.md`, `article-digest.md`, `config/profile.yml`, `modes/_profile.md`, `modes/_brief.md`), `sources` | stage a Notion → local pull; returns diffs |
| `profile-accept` | `pullId`, `requestRef`, optional `paths` | apply a confirmed pull (with backups) |
| `report-job` | `reportPath` | parse an upstream report into a job skeleton |
| `ingest` | `snapshot`, `settings`, `brief`, `jobs`, optional `limitations` | immutable run with resolved identities |
| `assess` | `runId`, `assessments` | validate against the reports, save, write `P) Personal Fit` into each report |
| `bind-identity` | `job`, verified `verification` | keep a stable job ID after a Notion create |
| `select` / `revoke` | `runId`, `jobIds`, `requestRef` / `jobIds`, `requestRef` | the selection gate |
| `materials-check` | `jobId`, `snapshotHash`, `jdHash` | is this role selected, against current inputs? |
| `materials-prepare` / `-payload` / `-render` / `-verify` | see `materials.mjs` | evidence-bound tailoring attempts |
| `plan-notion` / `journal` / `reconcile` | `base`, `current`, `intent`, `ownership` / `plan` / `plan`, `receipt`, `observations` | minimal, journaled, read-back Notion writes; multi-section bodies |
| `mirror-tracker` | `records`, `apply` | Notion Stage → `data/applications.md` through `merge-tracker` / `set-status` |
| `stage-map` | — | the Notion Stage → canonical state mapping |
| `sync-status` | — | local artifacts not yet in Notion |
| `record-push` | `path`, `operationId` (journaled), readback `observations`, optional `receipt`, `hash` (from `sync-status`) | recompute the reconciliation and mark the push done only if verified |
| `support` / `event-check` / `actions` | see `support.mjs` | interview, debrief, negotiation and follow-up context |

The validators in each module are the contract. Fictional examples live in `tests/`.

## How this differs from upstream, and why

| Upstream default | This fork | Where it is set |
|---|---|---|
| A pasted JD → `auto-pipeline` evaluates and tailors a PDF | evaluate only; tailor after explicit selection | `_custom.md`, `auto_pdf_score_threshold: 5.1` |
| The evaluation writes a cover-letter draft, Block E, answers (≥ 4.5) and story-bank entries | deferred until selection | `_custom.md` Evaluation Rules |
| `data/applications.md` is the master copy; the Notion plugin mirrors 4 fields | Notion is the master copy; `applications.md` is its mirror via upstream writers | `tracker-mirror.mjs` |
| The CV comes from `cv.md` | still from `cv.md`, which is pulled from Notion by a confirmed diff | `sync.mjs` |
| Fit = 1–5 score | score + band + UK gates + claim-ID evidence, in the same report | `assessment.mjs`, `report.mjs` |

Upstream rules that still apply unchanged: liveness before evaluation, JD archived in every report, never submit or send, no fabrication, provenance of story-bank figures, JDs treated as data.

## Maintenance

- **Tests:** `node personal-career/test.mjs` (the `.spec.mjs` suites; upstream reserves `.test.mjs` for its own managed directories). After an upstream update, also run `npm run lint`, `node validate-system-paths-coverage.mjs` and `node test-all.mjs --quick`.
- **Upstream updates:** `node update-system.mjs check` / `apply`. `personal-career/` is declared in `config/local-paths.txt`, and `.gitignore` rules you added are kept. Then rebase this branch: `git fetch upstream && git rebase upstream/main`.
- **Moving the checkout:** move it, then re-run `install-launchers.mjs`.
- **Known limits:** the Notion connector has no compare-and-swap (readback catches most races, not all). File attachments depend on the connector supporting uploads. The helpers validate structure and provenance; they cannot prove that prose is true.
