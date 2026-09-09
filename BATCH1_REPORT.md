# MRANTI CORE — Batch 1 completion report

## 1. Root causes found

- The application shipped about 654 KB and 14,048 lines in one HTML document, including about 258 KB of inline JavaScript and 29 inline style blocks.
- Firebase scripts were parser-blocking. CRM data could be reloaded and the full set of CRM views rebuilt unnecessarily.
- Calendar caching was memory-only. A restored Firebase session did not restore Calendar data or recover a Google Calendar token on a later visit.
- CRM search used normalized substring matching, so `aina` matched `Zainal`.
- Relationship search used one unranked haystack containing names, company data, email, phone, and generated bilingual Search Index text. Generic generated terms could therefore equal or overpower direct `MIDA` matches.
- Contact ordering preferred update metadata instead of the required meeting-date/input-date rule. The frontend API response did not include `Time Uploaded`.

## 2. Architecture before vs after

Before: one `index.html` held markup, 29 style blocks, configuration, authentication, Calendar, CRM, Context, Relationship Graph, search, and meeting logic.

After: `index.html` is the static shell; ordered styling is in `src/styles.css`; configuration, authentication, Calendar, CRM, Context/Relationship behavior, and shared search logic live in focused deferred scripts under `src/`. The application remains framework-free and compatible with repository-root GitHub Pages hosting.

## 3. Files created/changed

Changed: `index.html`, `site.webmanifest`, `README_DEPLOY.txt`.

Created: `src/config.js`, `src/auth.js`, `src/calendar.js`, `src/crm.js`, `src/contacts.js`, `src/search.js`, `src/styles.css`, `tests/search.test.cjs`, `tests/static.test.cjs`, `tests/workflow.test.cjs`, `package.json`, `n8n/MRANTI CORE Batch 1.json`, and this report.

## 4–5. Performance bottlenecks and changes

- Moved CSS and JavaScript into cacheable external assets and deferred application/Firebase scripts.
- Preserved Relationship Graph lazy loading.
- Added CRM load guards, cached Context groups, dirty invalidation after mutations, and avoided rebuilding every CRM view when returning to an already loaded route.
- Added persisted, per-user Calendar month caching, freshness timestamps, stale-while-refresh behavior, and in-flight request deduplication.
- Network timing from this execution environment showed similarly high latency for both HTML and a tiny favicon, which is not sufficient evidence that GitHub Pages is the application bottleneck. Hosting was therefore retained.

## 6. Calendar auto-sync fix

Firebase redirect completion is processed before restored-session initialization. A valid saved Google token is reused. Calendar months are fresh for 10 minutes and usable as stale cache for 36 hours. A restored user sees cached meetings immediately and stale data refreshes automatically. If the Google token is absent, CORE attempts one promptless Calendar reauthorization, guarded by a per-session flag and a six-hour retry cooldown. Manual Sync still forces a network refresh. Expired authorization falls back to cached data and presents a reconnect path.

## 7–9. Search algorithm, MIDA, and Aina

Shared token-aware scoring ranks exact person/company matches, then token/prefix person/company matches, email/domain/known abbreviation matches, contextual fields, and finally BM/English Search Index terms. Phone search remains partial numeric matching for three or more digits.

`Aina` now matches a token such as `Aina A Rahman` and does not match the interior of `Zainal`. `MIDA` failed because all fields were flattened into an unranked substring haystack; the graph now assigns priority tiers and excludes low-priority generated-index matches when a direct organisation/person match exists. Existing bilingual Search Index generation and legacy index consumption remain intact.

## 10. Sorting

Records sort by the most recent valid associated meeting date. If absent, they use submission/input metadata (`Time Uploaded`, submitted/created timestamps, then legacy update date). Missing or invalid dates score as zero and cannot break sorting. An explicitly selected product sort remains authoritative where provided.

## 11–12. Naming

User-facing workspace identity is now `CORE` while MRANTI branding and risky internal identifiers remain unchanged. Navigation, page labels, empty states, help/profile copy, and module messages use `Context` for the relationship/context module. Literal person-detail labels such as “Contact Name” remain where they describe contact data rather than the module.

## 13. Share behavior

Context and Relationship Graph have Share actions. They use Web Share when available and otherwise copy the URL with visible feedback. URLs preserve the route; Context includes only a stable record identifier when available. Tokens and private record content are never placed in the URL.

## 14. n8n changes

The complete importable workflow is `n8n/MRANTI CORE Batch 1.json`. Functional changes:

1. `Format CRM Contacts Data`: returns `timeUploaded`/`createdAt` for fallback ordering.
2. `Build Relationship Graph Page`: implements ranked token-aware matching and fixes normalization in the generated page.

User-facing copy only changed in `On form submission1`, `Redirect CRM Contacts to Main App`, and the three `Authorize CRM ...` nodes. The Manual, OCR, Meeting, and Backfill Search Index nodes are unchanged. All 23 credential assignments are unchanged.

## 15. Regression results

Automated: 16 tests pass, covering Aina/Zainal, MIDA ranking, email/domain, partial phone, BM/English Search Index, sorting, static asset references/order, naming, Share actions, workflow nodes and generated graph-script compilation, API date mapping, and credential preservation. All six JavaScript files pass syntax checks. The manifest and workflow parse successfully.

Live signed-out baseline: the production shell loaded and showed no new application-origin critical console error. Authenticated first sign-in, restored sign-in, live Calendar/CRM API calls, meeting submission, business-card intake, and graph interaction require an authorized `@mranti.my` test account and deployment of this branch/workflow; they remain release-gate checks rather than simulated passes.

## 16–17. GitHub and deployment

Local branch: `core-batch-1-foundation`. The connected GitHub identity has pull access but not push access, so no remote branch or pull request was created. A commit, patch, and upload-ready archive accompany this report. Production was deliberately not changed.

## 18. Remaining risks

- Promptless Google reauthorization depends on Google session/cookie policy; when blocked, the safe fallback is cached Calendar data plus the existing explicit reconnect action.
- The n8n workflow must be imported/activated in the correct environment before frontend date sorting and graph ranking are fully effective.
- Authenticated production regression checks above must be run during review with an authorized account.
