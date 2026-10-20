# Notion read / plan / write protocol

Notion owns profile and application lifecycle. Query the existing data source with pagination before proposing creates; include all stable identities. A company/title pair is not an identity. Preserve unknown source edit timestamps as null; record retrieval time separately. Store the observed schema and a canonical fingerprint.

1. Read schema and all relevant pages. Resolve identity with the helper. Conflicting matches and incomplete indexes block creates.
2. Build a base, current and intent object for `plan-notion`. Properties use the current connector's normalized names/types. Existing Notes and legacy Status are never owned by this workflow. Dates and contacts require an actual confirmed event or explicit scheduling request naming authorized fields.
3. Re-fetch touched pages and schema immediately before writing; recompute the plan. Stop on conflicts. An omitted property is not a request to clear it.
4. Run `journal` before external IO. Include `career-ops-operation:<operationId>` as a searchable literal inside the new page's managed section. Save the intended identity, schema hash, expected values and exact write payload outside the checkout.
5. Perform only the planned minimal properties and owned body-section changes through the connected Notion tool. Never replace a whole existing page. A managed section uses literal boundaries `career-workflow:start` / `career-workflow:end`; preserve all surrounding human content. Duplicate boundaries are a conflict.
6. Read the page back. Normalize the observed properties/section and run `reconcile`. Persist the receipt, observation and reconciliation result in the operation journal. Success requires observed intended values, not only a success response.

A lost or asynchronous create response must never be blindly retried. Query for the exact operation marker: one result can be adopted, zero stays pending, multiple conflict. An update partially applied stays pending; re-fetch and replan only remaining differences. A definitive connector rejection may be recorded as `definite_failure`, but only when the connector confirms nothing was written.

There is no atomic compare-and-swap in the connector. Immediate re-fetch and readback detect many races, but cannot eliminate cross-client changes between those calls. Report conflicts without overriding human data.

Creates enter Wishlist. Selection can move Wishlist to Preparing. Assessment, CV creation and drafts do not imply submission. Preserve other stages. CV-library versions are new records linked by relation union; never replace older CV relations. Deferred corrections affect effective local context but must not appear in any outgoing Notion intent until the user authorizes that update.
