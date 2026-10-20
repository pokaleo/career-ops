# Interview and offer support

Existing applications enter directly through `support`; an active process does not need discovery or selection.

**Refresh** ([sync](sync.md)): the application page, its original JD (the report's archived section, or the employer page), the **actual submitted CV** from the CV library relation, recruiter correspondence, confirmed events and relevant evidence. A CV-library relation alone does not identify which version was submitted. If that is unknown, say so and do not rehearse unverified claims from the newest draft.

Use the upstream modes after reading them: `interview-prep` (company intel → `interview-prep/{company}-{role}.md`), `interview/plan`, `interview/practice`, `interview/debrief` (sessions → `interview-prep/sessions/`). Do not import their automatic status updates or unsourced metrics; `story-bank.md` figures need a provenance marker (`story-provenance-check.mjs`) before they are cited as fact.

- **Preparation pack:** round format and rubric, the strongest defensible examples, likely technical and business questions, knowledge gaps, a concise introduction, questions for the interviewer. For coding, timed implementation with edge cases. For architecture, components, data flows, state, failure recovery and tradeoffs, with diagrams where helpful.
- **Mock practice** (when asked): one question at a time. Give feedback on factual accuracy, structure, depth and delivery separately, with a revised answer grounded in confirmed evidence. Suggested phrasing is coaching, never a new fact.
- **After a real interview:** record the actual questions, answers and feedback. Use `event-check` for confirmed events, keeping unknown dates as null. A completed interview is not a passed round.
- **Offer / negotiation:** compare annual base, variable pay, sponsorship commitment, responsibilities, work pattern and progression. Use delivery and ownership evidence for the market case. Draft the negotiation; sending and accepting need the user's explicit instruction. Upstream `offer-prep` covers contract clauses.

**Push** ([Notion protocol](notion.md)): the prep pack and session notes go to the application page's `career-workflow-interview` section; a confirmed event updates Stage and dates through `plan-notion` with that event; story-bank changes go to the profile page's `career-workflow-story-bank` section. `record-push` each file, then `mirror-tracker`. Deferred rejection or interviewer corrections affect local context only.
