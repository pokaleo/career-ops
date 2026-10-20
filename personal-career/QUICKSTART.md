# Quickstart: our local career-ops

This is a local-run fork of career-ops. Notion is the master copy and `career-data/` in this folder is the local mirror. Roles are shortlisted first, and a CV is tailored only for roles you explicitly select. The full reference is [README.md](README.md).

```
find / paste JD ──► evaluate (report + fit) ──► Notion "Wishlist" ──► you select
                                                                        │
      follow up ◄── interview prep ◄── you submit ◄── tailored CV ◄─────┘
```

## 1. One-time setup (≈10 min)

Paste this whole block into a terminal. It starts by moving to the repository root, which every command needs:

```bash
cd ~/Development/career-ops
npm install --ignore-scripts
npx playwright install chromium
cat .career-ops-data
node personal-career/install-launchers.mjs
node personal-career/test.mjs
node doctor.mjs
```

What each line does, and what to expect:

1. `cd` — every command assumes the repository root, not `personal-career/`.
2. `npm install --ignore-scripts` — dependencies (upstream ships no lockfile).
3. `npx playwright install chromium` — the browser used for PDF rendering and the liveness fallback.
4. `cat .career-ops-data` — prints `career-data`, the data root marker.
5. `install-launchers.mjs` — writes the Claude and Codex launchers.
6. `test.mjs` — expect `pass 42`, `fail 0`.
7. `doctor.mjs` — lists any remaining setup warnings.

(There are no inline `# comments` in the block on purpose: zsh passes them to the command as arguments unless `setopt interactive_comments` is set.)

**Connect Notion** (once per machine; no token is stored):

| CLI | How |
|---|---|
| Claude Code | `claude mcp add --transport http --scope user notion https://mcp.notion.com/mcp`, then `/mcp` → `notion` → approve your workspace |
| Codex | enable the Notion app |

Check it: `claude mcp list` should show `notion … ✔ Connected`.

**If `career-data/` is missing** (a fresh clone): it is git-ignored, so restore it from your backup. Its key files:

- `config/personal-career.json`: your settings (salary floor/target in GBP, sponsorship, London/UK-remote, role families, shortlist size)
- `config/notion.json`: where your Notion profile, Applications DB and CV Library live
- `modes/_custom.md`: the house rules that make upstream modes follow this workflow

## 2. First run

Open Claude Code (or Codex) **in the repository root** and say:

> **"use personal-career to sync with Notion"**

The first sync:

1. Pulls your Notion profile and CV into `career-data/cv.md` (plus `_profile.md` and `article-digest.md`). **You'll see a diff; nothing is overwritten until you say yes.** This also clears doctor's `cv.md` warning.
2. Mirrors the Notion tracker into `career-data/data/applications.md`. If a Notion record is incomplete (for example a blank Company), it tells you which one to fix.
3. Asks once whether to add a `Score` (number) property to the Applications database.

Optional: "re-evaluate my five existing Wishlist roles" gives them proper reports and 1–5 scores.

## 3. Everyday use

Say these in a session inside the repo:

| You want to… | Say | What you get |
|---|---|---|
| find roles | "use personal-career to find roles" | scan + web search → liveness check → evaluation reports → Notion Wishlist → a shortlist. **No CVs yet.** |
| check one job | paste the link or JD | the same, for one role |
| apply | "I select Acme and Globex" | Notion → Preparing; tailored CV PDF (fact-checked, you review it) → CV Library. **You submit.** |
| record progress | "I applied to Acme" / "Globex rejected me" | Notion Stage updated, local tracker mirrored |
| prepare | "prepare me for the Acme interview" | prep pack built against the CV you actually sent → Notion page |
| practise | "mock interview, one question at a time" | questions + feedback; debrief notes saved |
| follow up | "what should I follow up on?" | action list + draft messages (never sent for you) |
| change preferences | "raise my minimum base to £80k" | `personal-career.json` updated, used from the next run |
| catch up | "sync" | pulls Notion changes, pushes anything local that isn't in Notion yet |

Each result shows a **1–5 score** and a band: **Strong** ≥ 4.0, **Moderate** 3.5–3.9, **Stretch** < 3.5. It also lists UK checks (base salary vs your floor, sponsorship, London/UK-remote) marked *eligible*, *verify* or *blocked*. Below 4.0 the advice is not to apply, unless you have a reason.

## 4. Where things are

| What | Where |
|---|---|
| Evaluation reports | `career-data/reports/NNN-company-date.md`, and the application's page in Notion |
| Tailored CVs | `career-data/output/`, and the Notion CV Library |
| Interview prep | `career-data/interview-prep/`, and the application's page in Notion |
| Tracker | Notion Applications DB (master); `career-data/data/applications.md` (mirror) |
| Not yet in Notion | `node personal-career/cli.mjs sync-status -` |

## 5. Ground rules

- **Selection is explicit.** A high score never triggers a CV; only "I select X" does.
- **You submit and send.** The assistant drafts; it never clicks Apply or sends a message.
- **Notion wins.** Edit facts in Notion (or tell the assistant); local files are refreshed from it. Your `Notes` and the old `Status` column are never touched.
- **No invented facts.** CVs come only from your confirmed profile; numbers must trace to a source.

## 6. Housekeeping

| When | Do |
|---|---|
| career-ops update offered | say yes. Afterwards: `node personal-career/test.mjs`, `npm run lint` |
| moved this folder | `node personal-career/install-launchers.mjs` |
| backup | copy `career-data/` somewhere safe; it is deliberately not in git |
| old Codex copy | the original Codex build folder outside this repo can be deleted once you're happy |

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Notion is unavailable" | `claude mcp list`; if it isn't connected, `/mcp` → `notion` → re-authorise. Meanwhile results are labelled "local mirror only". |
| "Data root inside the checkout must be a git-ignored subfolder" | `.gitignore` must contain `/career-data/`, and nothing under it may be tracked (`git ls-files career-data` should print nothing) |
| "Role has not been explicitly selected" / "Selection stale" | say "I select X" again; a changed JD or profile needs a fresh selection |
| PDF not generated | `npx playwright install chromium` |
| doctor: `cv.md` has no Experience section | run a sync so `cv.md` is pulled from Notion |
| `personal-career` skill not offered in Claude Code | run Claude Code from the repo root; re-run `install-launchers.mjs` |
