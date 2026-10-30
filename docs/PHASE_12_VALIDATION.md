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
