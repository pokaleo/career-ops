# Discovery and assessment

**Refresh first** ([sync](sync.md)): the Notion profile, the full paginated application index, and settings from `{DATA_ROOT}/config/personal-career.json`. Store the run snapshot (sources, claims, records, schema fingerprint). Reconcile explicit settings changes with the current request. A newer AI synthesis does not make an uncertain claim true.

## 1. Find postings

- `node scan.mjs` (zero-token ATS scan over `portals.yml`), then targeted web search across every configured role family for employers the scan does not cover. Add a recurring miss to `portals.yml` with the upstream `discover` mode or `coverage-check.mjs`.
- `node check-liveness.mjs <url>` for every candidate posting before evaluating it. Aggregator listings must be confirmed at the employer (AGENTS.md → Aggregator Listings); the employer URL is canonical.
- For a pasted JD with no stable URL or ATS identity, try to find the official posting. If its identity stays unknown, give a provisional assessment in chat only, keep the text in private scratch notes, and do not invent a URL or create a record.

## 2. Evaluate with upstream `oferta`

Run `oferta` per posting under the `modes/_custom.md` Evaluation Rules. It reserves a report number, archives the JD verbatim, and writes `reports/NNN-company-date.md` plus the tracker TSV. It skips Block E, the cover letter, form answers and story-bank appends until selection.

## 3. Add the personal assessment

1. `report-job` with `reportPath` (the report must archive the JD text verbatim, not a `jds/` pointer) returns the company, title, URL, archived JD, score and confidence parsed from the report.
2. Build each job: that output plus `checkedAt`, ATS `namespace` / `requisitionId` when known, and `facts` — `baseGBP {min,max}` (annual base only; bonus, equity and OTE never count), `sponsorship` (`confirmed | conditional | unknown | not_available`), `london`, `ukRemoteFromLondon` (`true | false | null`), plus work model, attendance and travel notes.
3. `ingest` (snapshot, settings, brief, jobs, coverage limitations). Identity is upstream's posting key (aggregator IDs, hash routes), then ATS namespace + requisition, then the Notion page ID and report number. Two matching Notion pages block the run; company and title alone never merge vacancies.
4. `assess` per job: `score` and `confidence` copied from the report, `fit` = its band (Strong ≥ 4.0, Moderate 3.5–3.9, Stretch < 3.5), the `evaluateEligibility` result, seven dimensions (skills, seniority, compensation, sponsorship, workLifeBalance, employer, location), matches citing a **claim ID and an exact quote from the archived JD**, gaps with sources, and positioning. The helper refuses an assessment that disagrees with its report, then writes the `P) Personal Fit` section into the report.

Eligibility gates: base below the floor blocks; an overlapping band needs an offer at or above the floor; unknown salary or sponsorship is a verification item. An existing employer-bound visa, a sponsor licence, a right-to-work question or relocation help is not a sponsorship commitment. Attendance, travel, hours and on-call are tradeoffs judged case by case.

Label inferred skills, ownership and metrics as inferred. Distinguish prototypes, delivery readiness, production operation and measured outcomes.

## 4. Record and present

- Push each assessed role to Notion as a **Wishlist** record ([Notion protocol](notion.md)): Company, Position, Fit, Score, Salary / Salary Ceiling (GBP), Sponsorship, Location, Work Model, Reference Link, plus the report in the `career-workflow` section. Then `bind-identity`, `mirror-tracker`, and `record-push` for the report.
- Present up to `shortlistLimit` roles, fewer when evidence is thin: role, employer link, score + band, base or unknown, sponsorship or unknown, location and workload, strongest evidence, material gaps, recommendation. Include search coverage limits and the decision needed.
- **Stop at the shortlist** until the user selects roles.
