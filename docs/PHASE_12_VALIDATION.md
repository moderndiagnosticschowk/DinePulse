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

## Latest CI follow-up (2026-10-26)

- The prior report typecheck mismatch was fixed by treating the nested `branches` relation as an array.
- GitHub Actions then exposed a separate lint infrastructure failure: the web ESLint config used `FlatCompat` with Next.js 16's native flat config and triggered a circular-config error.
- `apps/web/eslint.config.mjs` now uses the native Next.js 16 flat config. A new successful typecheck/lint/build run is still required.

## Completion criteria
Do not mark Phase 12 complete until the three root checks pass and the multi-branch + pagination scenarios pass against staging. A code commit or successful hosting build alone is not end-to-end verification.

## Known limitation
Pagination prevents silent truncation, but this page still aggregates report data in the browser. For very high-volume branches, a server-side aggregate RPC with explicit date/branch filters and reconciliation tests should replace client-side aggregation in a later performance phase.
