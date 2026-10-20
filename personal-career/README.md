# Personal career workflow

An on-demand assistant workflow with local validation helpers. The existing Notion profile and application tracker remain authoritative. Private state must be outside this checkout.

The protected source is `personal-career/SKILL.md`. This directory is registered as local content so upstream updates preserve it. The original upstream entry points are not restricted by this extension.

Run extension tests with `node --test personal-career/tests/*.test.mjs`.

Selection records require an explicit user request reference. The assistant records that reference from the conversation; the helper cannot authenticate its meaning. A strong fit does not authorize tailoring. Material generation checks the selection against current profile and JD hashes; a material change requires reassessment and renewed selection.

## Setup

Use Node 24 and the fork's dependencies. Choose an external data directory and set `CAREER_OPS_DATA_DIR` or pass an absolute `dataRoot` in each JSON request. The upstream `.career-ops-data` marker is also supported. No credentials or API keys are required by the helpers; the assistant uses the user's connected Notion tools and public web sources.

Keep `config/personal-career.json` (editable preferences) and `config/notion.json` (source locations) in that private directory. A user-scope launcher at `$CODEX_HOME/skills/personal-career/SKILL.md` points at this protected skill and private setup. Preserve unrelated existing skills. If the checkout moves, update the launcher; never fall back to the upstream automatic pipeline.

For upstream-compatible projections, `profile` returns `cvMarkdown`, `profileYaml`, `profileMarkdown`, `briefMarkdown`, `customMarkdown`. Save them only in the private user layer (`cv.md`, `config/profile.yml`, `modes/_profile.md`, `modes/_profile-brief.md`, `modes/_custom.md`). The brief is mandatory for personal assessments.

## JSON commands

Run `node /absolute/checkout/personal-career/cli.mjs COMMAND input.json` from any directory, or use `-` for stdin. All inputs include `dataRoot`. Results are JSON stdout; diagnostics are stderr. Exit 0 is success, 2 invalid input, 3 blocked/conflicting prerequisites. Helpers perform no network writes.

| Command | Additional input |
|---|---|
| `profile` | `snapshot`, `settings` |
| `ingest` | `snapshot`, `settings`, `brief`, `jobs`, optional `limitations` |
| `assess` | `runId`, `assessments` |
| `select` | `runId`, `jobIds`, `requestRef` |
| `revoke` | `jobIds`, `requestRef` |
| `materials-check` | `jobId`, current `snapshotHash`, current `jdHash` |
| `plan-notion` | `base`, `current`, `intent`, `ownership` |
| `journal` | `plan` |
| `reconcile` | `plan`, `receipt`, `observations` |

Executable fictional examples live in `tests/fixtures.mjs` and `tests/*.test.mjs`. Source validators are the contract. Each run uses a new simple `runId`, saves full JDs and immutable input/assessment JSON under `data/personal-career/runs/`, and uses explicit supersession IDs for corrected facts. Refresh timestamps do not change profile hashes. Journal and selection locks serialize local writers; an interrupted lock must be investigated before removal.

Notion property/body writes follow `references/notion.md`; there is no atomic compare-and-swap. Uncertain create outcomes remain pending until an exact operation marker resolves them. These checks govern this entry point, not unrestricted shell commands or the original upstream Web/CLI workflows.
