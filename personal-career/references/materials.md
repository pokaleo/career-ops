# Selected-role materials

Resolve the user's explicit selection to stable job IDs from the shortlist. Praise or a high score is not a selection.

1. **Refresh** ([sync](sync.md)): the Notion profile, CV library and the application. If Notion changed the profile, pull it into `cv.md` / `article-digest.md` / `modes/_profile.md` as a confirmed diff **before** tailoring. Re-fetch the full employer JD and run `check-liveness.mjs`.
2. `select` with the conversation request reference. In Notion, Wishlist moves to **Preparing** ([Notion protocol](notion.md)).
3. `materials-prepare` with the current snapshot, settings, job, claim IDs and format (`html`, `latex` or `text`). If any hash changed, reassess (`oferta` + `assess`) and get a new selection.
4. Now run the parts the evaluation deferred, for this role only:
   - upstream `pdf` (or `latex`, `text`, per `cv.output_format`) for the tailored CV, generated from `cv.md`. Its fact gate (`verify-cv-facts.mjs`) and structure checks run as normal.
   - Block E customisation plan, `cover`, `apply` form answers, and the story-bank appends from Block F, all as upstream defines them.
5. Express every tailored statement in the `materials.mjs` payload shape and run `materials-payload`. It checks claim IDs, numeric tokens and expected qualifiers. Then review every sentence against its source; deterministic checks do not prove semantic truth or component ownership.
6. `materials-render` (or the upstream renderer the mode already ran), then extract the PDF text and inspect every page for clipping, overflow and missing sections. `materials-verify` with genuine `semanticRef` / `visualRef` review references. Only a verified manifest is ready to deliver.

Keep the distinctions between personal implementation, shared contributions, prototypes, deployment readiness and production ownership. Expected promotions stay expected; internal title ambiguity stays explicit; credential names stay exact. Never manufacture metrics, years, model-training expertise or leadership scope.

Each `materials-prepare` call creates a new immutable `attemptId`. Revisions and other formats are new attempts with distinct filenames in `output/`. Never overwrite the version that was submitted.

**Push** ([Notion protocol](notion.md)): create a new CV Library record with its live schema — attach the PDF when the connector supports file uploads; otherwise put the editable source in the record body and the local path and hash in its properties. Read it back, then add it to the application's `CV Version` relation by set union. Include the selection ID, attempt ID and evidence references. `record-push` each file in `output/`. Preparing remains distinct from Applied; the user submits.
