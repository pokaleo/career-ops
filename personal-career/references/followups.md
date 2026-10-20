# Progress and follow-ups

Run only when asked. **Refresh** ([sync](sync.md)): the Notion tracker, confirmed events and current direct-user corrections. Keep the difference between the current `Stage` and the legacy `Status`. Then `mirror-tracker` so upstream `followup`, `stats` and `funnel-velocity` read the same state.

Use `support` and `actions` to build a compact action list: application, effective stage, last confirmed event or contact, outstanding question, recommended action, suggested timing. Upstream `followup` (`followup-cadence.mjs`) supplies cadence and urgency; use it as guidance, never as evidence that time has passed. Deferred rejection corrections suppress follow-ups locally. Applied / Interview / On Hold must come from real evidence, not from a CV or a draft existing.

For each actionable process, draft a brief message anchored to the actual conversation and the employer's stated timing. If dates or promised response times are unknown, say so and propose timing; never invent an elapsed wait.

Drafting does not send. Save a date or status only when the user explicitly chooses it or confirms an actual event. `event-check` needs a user-confirmation reference and keeps null dates. A submitted application becomes Applied after the user confirms it; a prepared CV stays Preparing. A sent follow-up must be confirmed separately from its draft.

**Push** ([Notion protocol](notion.md)): confirmed changes go to Stage, `Follow-up Date`, `Last Contact` and `Next Action` (event-authorised fields only); drafts and history go to the application's `career-workflow-followups` section. Then `mirror-tracker` (which runs `set-status.mjs`, so the upstream status log and follow-up pins stay correct) and `record-push` for `data/follow-ups.md`.

Show pending verification items (sponsorship, base pay) next to the actions. Keep old interviewers, historical scores and closed processes out of active recommendations unless the user asks for a retrospective.
