# Phase 12 — Branch-aware analytics correctness

## Scope implemented in this branch
- Load the signed-in user's active branch memberships.
- Show a branch selector when the user has more than one active branch.
- Restore a saved branch only if it is still an active membership; otherwise fall back to the first active membership.
- Scope every report query to the selected branch and selected time window, including an explicit upper bound at the current time.
- Restrict best-selling item and payment-mix inputs to paid orders so open/cancelled orders do not inflate those views.
- Page through orders, order items and completed payments rather than silently truncating at the default 1,000-row result limit.

## Database work
- No schema migration is required; this phase uses existing `branch_memberships`, `orders`, `order_items`, and `payments` tables.
- RLS remains the security boundary. The browser uses the signed-in user's Supabase client; do not add a service-role key to the web app.

## API work
- No Express endpoint is added in this phase. Direct Supabase queries remain branch-filtered and subject to RLS.
- `.github/workflows/quality.yml` adds pull-request/main-push gates for root typecheck, lint and build.
- If real-world branch volumes make client-side aggregation too expensive, move aggregates into a reviewed SQL RPC/API endpoint in a later phase; do not reintroduce arbitrary row caps.

## UI work
- Display the selected branch in the report subtitle.
- Add an accessible branch selector for multi-branch users.
- Persist selection under `dinepulse:active-branch-id` and validate it against active memberships before using it.
- Keep the 7/30/90-day filters, refresh action, loading/error states and empty states.

## Database security preflight

`supabase/tests/phase12_report_security_contracts.sql` is a read-only staging assertion that checks RLS is enabled on `branch_memberships`, `orders`, `order_items`, and `payments`, and that the expected authenticated SELECT policies exist. It is a schema/policy contract check only; it does not prove row isolation. Complete the two-user/two-branch browser test below before marking the phase complete.

## Validation checklist
1. Single-branch user sees reports without needing to select a branch.
2. Multi-branch user can switch branches; all KPI, daily trend, best-seller, payment-mix and recent-order values change to the selected branch.
3. A saved branch ID that is no longer an active membership falls back to an allowed branch.
4. A user with no active branch sees the no-membership message; signed-out users see the sign-in message.
5. Seed more than 500 orders and more than 500 order items/payment rows; verify pagination includes all matching rows exactly once. Verify orders timestamped after the report's captured end time are excluded.
6. Verify open, unpaid and cancelled orders do not contribute to best-seller ranking or completed payment mix; paid sales totals reconcile with paid orders.
7. Test 7, 30 and 90 days, empty periods, refresh, slow responses and query errors. Rapidly switch branches/ranges while a request is in flight and confirm stale responses cannot overwrite the latest selection.
8. Run root `npm run typecheck`, `npm run lint`, and `npm run build`.
9. In staging, use two branches with distinct orders and confirm a branch-A user cannot read branch-B data by changing browser state or query parameters.

## Latest CI follow-up (2026-10-27)

- Latest completed Phase 12 quality workflow run #80: typecheck **passed**, lint **passed**, and build **passed**.
- Netlify deploy preview for PR #2: **success**.
- The lint/type issues in billing, inventory, kitchen, orders, POS, suppliers and tables were fixed with explicit row/response types and deferred effect initialization; the reports card map no longer has an unused-index warning.
- CI build uses non-secret placeholder Supabase public environment values for compilation only. Multi-branch RLS, pagination reconciliation and date-window tests remain unverified in staging.

## Database security preflight

`supabase/tests/phase12_report_security_contracts.sql` checks RLS is enabled on `branch_memberships`, `orders`, `order_items`, and `payments`, plus the expected authenticated SELECT policy names. A read-only query against the current live database on 2026-10-28 found all four RLS flags enabled and all four expected policies present. This is only a schema/policy preflight; it does not prove cross-branch row isolation. The new SQL contract file has not been executed in CI or staging yet.

## Update (2026-10-28)
- Added the read-only report RLS contract script and documented the distinction between policy presence and behavioral isolation.
- Quality workflow runs for the new commits are still in progress; two-branch browser tests and report-total reconciliation remain pending.

## Completion criteria
Do not mark Phase 12 complete until the three root checks pass and the multi-branch + pagination scenarios pass against staging. A code commit or successful hosting build alone is not end-to-end verification.

## Known limitation
Pagination prevents silent truncation, but this page still aggregates report data in the browser. For very high-volume branches, a server-side aggregate RPC with explicit date/branch filters and reconciliation tests should replace client-side aggregation in a later performance phase.
