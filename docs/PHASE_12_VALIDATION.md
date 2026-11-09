# Phase 12 — Branch-aware analytics correctness

## Scope implemented in this branch
- Load the signed-in user's active branch memberships.
- Show a branch selector when the user has more than one active branch.
- Restore a saved branch only if it is still an active membership; otherwise fall back to the first active membership.
- Scope every report query to the selected branch and selected time window, including an explicit upper bound at the current time.
- Attribute sales and daily sales trends to paid orders by `orders.paid_at`, while recent orders and open-order counts remain based on `orders.created_at`.
- Attribute payment mix to completed payment transactions by `payments.paid_at` within the selected period, including partial payments even when the parent order is not fully paid yet.
- Restrict best-selling item inputs to orders paid in the selected period so open/cancelled orders do not inflate the ranking.
- Page through orders, order items and completed payments rather than silently truncating at the default 1,000-row result limit.

## Database work
- Migration: `supabase/migrations/0012_phase12_report_query_indexes.sql` adds indexes for branch/created-time orders, branch/paid-time orders, order-item pagination, and completed payment timestamp queries.
- RLS remains the security boundary. The browser uses the signed-in user's Supabase client; do not add a service-role key to the web app.
- Apply migration 0012 on staging first and build the indexes during a low-traffic window. The migration has not been applied to production.

## API work
- No Express endpoint is added in this phase. Direct Supabase queries remain branch-filtered and subject to RLS.
- `.github/workflows/quality.yml` adds pull-request/main-push gates for root typecheck, lint and build.
- If real-world branch volumes make client-side aggregation too expensive, move aggregates into a reviewed SQL RPC/API endpoint in a later phase; do not reintroduce arbitrary row caps.

## UI work
- Display the selected branch in the report subtitle.
- Add an accessible branch selector for multi-branch users.
- Persist selection under `dinepulse:active-branch-id` and validate it against active memberships before using it.
- Keep the 7/30/90-day filters, refresh action, loading/error states and empty states.
- Query payment records by their own `paid_at` timestamp and the selected branch, rather than inheriting the parent order's final payment date.

## Database security/performance preflight

`supabase/tests/phase12_report_security_contracts.sql` is a read-only staging assertion that checks RLS is enabled on `branch_memberships`, `orders`, `order_items`, and `payments`, that expected authenticated SELECT policies exist, that `payments.paid_at` is available, and that the four report query indexes from migration 0012 exist. It is a schema/index contract check only; it does not prove row isolation or query-plan improvement. Complete the two-user/two-branch browser test and staging EXPLAIN/ANALYZE comparison before marking the phase complete.

## Validation checklist
1. Single-branch user sees reports without needing to select a branch.
2. Multi-branch user can switch branches; all KPI, daily trend, best-seller, payment-mix and recent-order values change to the selected branch.
3. A saved branch ID that is no longer an active membership falls back to an allowed branch.
4. A user with no active branch sees the no-membership message; signed-out users see the sign-in message.
5. Seed more than 500 orders and more than 500 order items/payment rows; verify pagination includes all matching rows exactly once. Verify rows timestamped after the report's captured end time are excluded.
6. Attribute sales and daily trend to `orders.paid_at`, not `orders.created_at`: include an older order paid inside the selected window, and exclude an order created inside the window but paid after its end. Keep Recent Orders based on `created_at`.
7. Attribute payment mix to `payments.paid_at`: include completed payments inside the selected window, exclude completed payments outside it, and include a partial payment even if its order's final `paid_at` is outside the window.
8. Verify open/unpaid/cancelled orders do not contribute to best-seller ranking; completed payment transactions are counted only once in payment mix.
9. Test 7, 30 and 90 days, empty periods, refresh, slow responses and query errors. Rapidly switch branches/ranges while a request is in flight and confirm stale responses cannot overwrite the latest selection.
10. Run root `npm run typecheck`, `npm run lint`, and `npm run build`.
11. In staging, use two branches with distinct orders and confirm a branch-A user cannot read branch-B data by changing browser state or query parameters.
12. Compare EXPLAIN (ANALYZE, BUFFERS) for the report queries before/after migration 0012 on a representative staging dataset; confirm the new indexes are selected where appropriate and totals remain unchanged.

## Previous CI (2026-10-30 before today's report query update)
- Quality workflow run #109 for the previous PR head passed typecheck, lint and build.
- The payment-timestamp query update, migration 0012, and expanded SQL preflight are newer changes; their own workflow and staging results are still pending.
- CI build uses non-secret placeholder Supabase public environment values for compilation only. Staging RLS, pagination reconciliation and report-total tests remain unverified.

## Database security preflight history
- A read-only query against the live database on 2026-10-28 found RLS enabled and the expected SELECT policy names present on all four report tables. This is only schema/policy evidence, not proof of cross-branch row isolation.

## Completion criteria
Do not mark Phase 12 complete until the current code checks pass, migration 0012 is applied on staging, the SQL preflight passes, and multi-branch isolation, payment-time attribution, pagination, date-window, report-total and query-plan tests pass. A code commit or successful hosting build alone is not end-to-end verification.

## Known limitation
Pagination prevents silent truncation, but this page still aggregates report data in the browser. For very high-volume branches, a server-side aggregate RPC with explicit date/branch filters and reconciliation tests should replace client-side aggregation in a later phase.


## Daily verification update (2026-10-31)
- Latest PR-head GitHub Actions run #41002957138 completed successfully: root typecheck, ESLint, and production build passed.
- Read-only live schema inspection confirmed orders.created_at, orders.paid_at, payments.paid_at, payment/order status fields, and the current live branch-scoped/report-related indexes.
- The four indexes introduced by migration 0012 are not yet confirmed in production; migration 0012 was not applied.
- The SQL preflight now checks required timestamp/status columns, RLS and policy contracts, index validity, and expected index column/predicate definitions. It has not yet been executed against staging.
- The live RLS/policy catalog confirms expected policies exist, but catalog checks alone do not prove Branch A cannot read Branch B rows.
- No Supabase staging branch exists. Creating one may incur compute charges and is intentionally not done automatically.

## Remaining acceptance gates
Run migration 0012 and the expanded SQL preflight on a disposable schema-matched staging database; then execute two-user/two-branch row-isolation tests, 500+ row pagination reconciliation, partial-payment transaction-time attribution, date-boundary checks, and EXPLAIN (ANALYZE, BUFFERS) comparisons. Keep the PR draft until all pass.

## Daily implementation update (2026-11-01)
- Strengthened the read-only SQL preflight to verify the actual SELECT policy predicates for branch memberships, orders, order items and payments, not just policy names. The required predicates must reference the signed-in user or `user_has_branch_access`.
- Index checks now require each report index to be both valid and ready, and verify the PAID/COMPLETED partial-index predicates and the payment timestamp non-null predicate.
- Live catalog inspection confirms the current policy definitions include branch-access checks for orders, order items and payments, and self-membership filtering for memberships. This is catalog evidence only; two-user/two-branch row-isolation tests remain required.
- Latest existing PR-head quality runs #123 and #126 passed typecheck, ESLint and production build. The new SQL preflight commit still requires its own CI run and staging execution.
- No report migration was applied to production. Phase 12 remains incomplete until migration 0012, SQL preflight, row-isolation, pagination reconciliation and EXPLAIN/ANALYZE checks pass.


## Daily implementation update (2026-11-02)
- Expanded the SQL preflight to assert that orders.status exposes the PAID enum state and payments.status exposes COMPLETED, because the report queries depend on those exact values, not merely on the columns existing.
- The assertion resolves the status column's actual public enum type through the catalog rather than assuming a fixed enum type name.
- The current PR-head typecheck/lint/build checks from the previous commit passed; this new SQL-test commit requires its own workflow run.
- No report index migration was applied to production. The SQL preflight and two-branch/pagination/reconciliation tests still require staging execution.

## Daily implementation update (2026-11-03)

- Added `scripts/validate_sql.py` using pglast and wired it into the quality workflow to parse every migration and SQL contract test in the repository on PR/push. This adds SQL statement-grammar and dollar-quote framing checks alongside typecheck, lint and build.
- The parser does not execute migrations, validate catalog-dependent assertions, prove RLS row isolation, or compile PL/pgSQL function bodies. Apply migration 0012 and run the SQL preflight on a schema-matched staging database before accepting the phase.
- The previous PR-head quality run #153 passed typecheck, ESLint and production build. The new SQL-parser workflow commits require fresh CI runs.
- No migration was applied to production and no change was made to `main`.

## Final CI verification (2026-11-03)
- PR-head GitHub Actions run #175 completed successfully: pglast parsed all 8 SQL files (6 historical migrations, migration 0012, and the Phase 12 contract test) with zero parser failures; typecheck, ESLint, and production build also passed.
- Netlify deploy preview is successful for the current PR head.
- SQL parsing does not execute migrations, validate catalog-dependent assertions, prove RLS row isolation, or compile PL/pgSQL function bodies.
- Migration 0012, SQL preflight, two-branch row isolation, pagination reconciliation, payment-time/date-window reconciliation and EXPLAIN/ANALYZE remain pending on a schema-matched staging database. Phase 12 is still incomplete.


## 2026-11-04 regression checks
- The **Open orders** KPI is a live operational count for the selected branch and must not be restricted by the selected 7/30/90-day reporting window. Verify an old still-open order is included.
- The branch membership relation to `branches` is many-to-one; the UI must read the nested branch as an object (or null), not an array, and display the branch name in both the heading and selector.
- Confirm branch switching cancels stale report requests and updates both historical metrics and the current open-order count.


## Daily implementation update (2026-11-05)
- Normalized the nested `branches` relation used by branch memberships. PostgREST's many-to-one object shape is now supported, while array-shaped relationship metadata remains tolerated for compatibility.
- The selected branch heading and branch selector both use the same normalized branch-summary helper, avoiding a blank branch label when the response is an object rather than an array.
- Acceptance checks: verify branch names render for object, array, empty-array and null relation shapes; branch IDs remain the authorization/filter source; changing branches still invalidates stale report responses and refreshes the current open-order count.
- No database schema or API endpoint change was required.
- Migration 0012, the SQL preflight, two-user/two-branch row isolation, pagination reconciliation, partial-payment/date-window checks, report-total reconciliation and staging EXPLAIN/ANALYZE remain pending. Phase 12 remains incomplete.


## Daily implementation update (2026-11-06)
- Corrected INR report formatting to always show two decimal places (paise); the previous formatter rounded every KPI/table amount to whole rupees.
- Added a shared report-money helper that parses decimal database values into integer paise before aggregation. Paid sales, daily sales, best-seller line totals and payment-method totals now sum integer minor units and convert back only for display, avoiding binary floating-point accumulation drift.
- Added dependency-free Node.js unit tests for decimal parsing, half-up paise rounding, negative values, invalid/non-finite input, safe-integer bounds and INR formatting.
- Added the report-money unit test to the Phase 12 GitHub Actions quality workflow.
- Manual staging acceptance: reconcile KPI, daily trend, best-seller totals and payment mix against SQL sums; verify values such as ₹0.50, ₹123.45 and aggregate ₹0.10 + ₹0.20 display as ₹0.50, ₹123.45 and ₹0.30 respectively.
- No database schema change or production deployment was made. Migration 0012 and branch-isolation/financial reconciliation tests still require a schema-matched staging database.


## 2026-11-06 CI follow-up
- The first workflow attempts for the new currency test exposed two setup issues: the test file was not yet present on the branch for the earliest run, and the initial decimal parser regex was over-escaped. Both were corrected; the report-money unit-test step then passed.
- Workflow run #42161424700 next caught a duplicate `OPEN_ORDER_STATUSES` declaration introduced while replacing the old formatter. Removed the duplicate in commit `4459cc507f48b93a87cec91d12a570153b46a23b`.
- The corrected commit's complete GitHub Actions and deploy-preview results must be checked before considering the code checks green. The report-money unit tests passed on the preceding run, but its typecheck/build did not pass due to the duplicate declaration.
- Staging migration 0012, two-branch row isolation, pagination reconciliation, payment-date/report-total reconciliation and EXPLAIN/ANALYZE remain release gates.

## Production data-volume audit (2026-11-07)
- Read-only exact counts on the live project are currently zero for orders, order_items, payments, purchases and stock_movements. This means production cannot validate report totals, pagination completeness or representative query plans today.
- Do not seed synthetic rows in production. Use a disposable schema-matched staging database with at least 500 orders, 1,200 order_items, 600 completed payments, partial-payment cases, multiple payment methods, at least two branches, and open orders older than the selected 7/30/90-day window.
- Run the SQL preflight after migration 0012, then compare EXPLAIN (ANALYZE, BUFFERS) for recent orders, paid-order sales, order-item pagination and completed-payment mix before/after the four report indexes.
- Verify row isolation using two authenticated users with disjoint branch memberships; catalog policy predicates alone are not an isolation test.
- Production migration 0012 remains unapplied; no development branch was created because branch creation can incur compute charges. No production DDL or deployment was performed.

## Daily implementation update (2026-11-08)
- Extracted daily sales, best-seller and payment-mix aggregation into pure helpers in `apps/web/lib/report-aggregations.mjs`.
- Daily trend aggregation now uses a single pass over paid orders plus the requested day buckets (O(orders + range)), rather than filtering the full order list once per day. It uses local calendar-day keys, zero-fills missing days, attributes by `paid_at`, and ignores invalid/missing timestamps and non-PAID rows when status is provided.
- Best-seller and payment-method totals continue to aggregate integer paise. Payment mix additionally ignores non-COMPLETED rows if any are passed to the helper.
- Added Node unit tests for zero-filled day buckets, payment-time attribution, partial payment aggregation, invalid dates/statuses, top-item grouping, payment-mix filtering and limits. CI now runs both report-money and report-aggregation test files.
- No schema or production change. Migration 0012, two-branch row isolation, 500+ row pagination reconciliation, financial reconciliation and staging EXPLAIN/ANALYZE remain release gates.


## Daily implementation update (2026-11-09)
- Added a regression test proving sales attribution is based on `orders.paid_at`, not creation time: an order created before the selected 7-day window but paid inside it contributes to today's sales; an order created inside the window but paid after the report end is excluded.
- The report page already uses a separate paginated `paid_at` query for paid sales and a `created_at` query for recent orders; this test protects that distinction at the aggregation boundary.
- The new test is committed to the Phase 12 branch. Its own GitHub Actions run must pass before the code check is marked green.
- Migration 0012, two-branch isolation, 500+ row pagination reconciliation, payment-time SQL reconciliation and staging EXPLAIN/ANALYZE remain pending. No production changes were made.
