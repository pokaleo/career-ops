# Discovery and assessment

Read `{DATA_ROOT}/config/personal-career.json` and the linked Notion current profile. Settings are editable: reconcile explicit changes with the current user request and Notion before each run. Store a fresh versioned snapshot of sources/claims and the fully paginated application index. Do not assume a newer AI synthesis makes an uncertain claim true.

Require the candidate brief. Use broad searches across all configured role families; assess responsibilities and scope individually. Search official employer pages and ATS listings, optionally using upstream scanner providers. Archive the full JD with original URL, canonical URL, ATS namespace/requisition, source facts and retrieval time. Identify cached, closed and evergreen postings explicitly.

For a pasted JD without a stable URL/ATS identity, try to locate its official posting. If identity remains unknown, give a provisional assessment in chat and preserve the supplied text in private scratch notes; do not invent a URL or force it into the run/index. Likewise, when Notion access or index completeness is missing, provisional findings stay in dated private notes with the cache date, missing sources and explicit limitations. They cannot authorize selection, materials or Notion creates. A matched old record is not proof of current evidence: refresh it before normal ingestion.

`ingest` validates provenance, private paths and stable identity. Tracking parameters may be removed; identity-bearing query parameters and case-sensitive paths must survive. If two existing pages match, resolve the ambiguity before writing. Similar company/title alone never merges vacancies.

Assess each job against documented experience, separating matches, gaps, seniority, employer evidence, compensation, location, sponsorship and work-life balance. Match evidence includes a claim ID and exact JD excerpt. Skills/ownership/metrics inferred from code or coaching remain labelled as such. Differentiate prototypes, delivery readiness, production operation and measured outcomes.

Use `evaluateEligibility` for gates:

- Compare annual GBP **base** with the editable floor. Bonus, equity and OTE cannot establish base. Unknown salary is flagged, not estimated or treated as zero. An overlapping band needs an offer at/above the floor.
- Retain unknown/conditional sponsorship with verification flags. An existing employer-bound visa, sponsor licence, right-to-work question or relocation assistance is not a role sponsorship commitment.
- Assess London and UK-remote-from-London availability from the actual JD. Attendance, travel, hours and on-call are case-by-case tradeoffs, not hidden exclusion thresholds.

Save immutable assessments with `assess`. No CV/cover/answers/STAR content belongs in them. Use Strong/Moderate/Stretch fit and clear rationale rather than a made-up weighted cutoff. Show up to the configured limit, fewer if evidence is insufficient.

Present role, employer link, base/unknown, sponsorship/unknown, location/workload, strongest relevant evidence, material gaps and recommendation. Include search coverage limitations and the decision needed from the user. Persist reviewed Wishlist records in the existing database via the Notion protocol. Stop at the shortlist until the user selects roles.
