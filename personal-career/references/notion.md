# Notion read / plan / write protocol

Notion is the master store for the profile, the application lifecycle, the CV library and every artifact this workflow produces. Access goes through the connected Notion MCP tools (Claude Code: the `notion` server; Codex: the Notion app). Locations are in `{DATA_ROOT}/config/notion.json`. Upstream's bundled `plugins/notion` (API token, a different schema) stays disabled.

## Owned surface

| Notion object | Owned by this workflow | Never touched |
|---|---|---|
| Applications DB properties | Company, Position, Stage (per the rules below), Fit, Score, Salary, Salary Ceiling (GBP), Sponsorship, Location, Work Model, Reference Link, Priority, Wave, Next Step; event-authorised Application / Interview / Follow-up Date, Last Contact, Next Action, Recruiter / Contact | `Notes`, legacy `Status` |
| Application page body | `career-workflow` (report + personal fit), `career-workflow-interview`, `career-workflow-followups` | everything outside the markers |
| Profile page body | `career-workflow-cv` (local CV edits not yet in Notion), `career-workflow-story-bank` | everything else |
| CV Library | new version records only | existing versions |

`Score` is a Number property. If the database lacks it, ask the user once before adding it with the connector's database-update tool; until then, keep the score in the report section only.

Each managed section sits between literal lines `<section>:start` and `<section>:end` (for example `career-workflow-interview:start`). Duplicate markers are a conflict.

## Steps

1. Query the data source with pagination before proposing creates, with every stable identity. A company and title pair is not an identity. Keep unknown source edit timestamps as null and record retrieval time separately. Store the observed schema and a canonical fingerprint.
2. Build `base`, `current` and `intent` for `plan-notion`. Use the connector's normalised property names and types. `ownership` lists the owned properties and `sections`. Use `intent.sections` (a map of section name to body) to update several sections at once, and `kind: "sync"` for pushes that must not move the Stage. A sync intent carries `artifact: {path, hash}` (from `sync-status`), so the journaled plan records which file version it pushes. Dates and contacts need a confirmed event or an explicit scheduling request that names those fields.
3. Re-fetch the touched pages and schema immediately before writing and recompute the plan. Stop on conflicts. An omitted property is not a request to clear it.
4. `journal` before any external call. Put `career-ops-operation:<operationId>` as a searchable literal inside a new page's managed section. Save the intended identity, schema hash, expected values and exact payload outside the checkout tree that git tracks (the data root qualifies).
5. Make only the planned minimal property and owned-section changes. Never replace a whole page; keep all surrounding human content.
6. Read the page back, normalise what you observe, and run `reconcile`. Success means the intended values were observed, not merely that the call returned. After a verified create, `bind-identity` with the original job. After any push of a local file, `record-push` with the path, the journaled operation ID, the readback observations and the file hash `sync-status` reported. It recomputes the reconciliation itself and records nothing unless it is verified.

A lost or asynchronous create is never blindly retried. Query for the exact operation marker: one result is adopted, zero stays pending, several are a conflict. A partially applied update stays pending; re-fetch and replan only what remains. A connector rejection may be recorded as `definite_failure` only when the connector confirms nothing was written.

The connector has no atomic compare-and-swap. Re-fetching right before writing and reading back afterwards catch most races, but cannot rule out a change from another client between the two. Report conflicts; never override human data.

## Stage rules

Creates enter **Wishlist**. Selection moves Wishlist to **Preparing**. Applied, Recruiter Screen, the interview stages, On Hold, Offer, Accepted, Rejected and Withdrawn need a confirmed event (`event-check`). Assessment, CV creation and drafts never imply submission. CV-library versions are new records linked by relation union; never replace older CV relations. Deferred corrections affect local context only and never appear in an outgoing intent until the user authorises that update.

Local mirror mapping (`stage-map`): Wishlist / Preparing → Evaluated, Applied → Applied, Recruiter Screen → Responded, Technical Interview / Hiring Manager / Final Interview / On Hold → Interview, Offer → Offer, Accepted → Hired, Rejected → Rejected, Withdrawn → Discarded.
