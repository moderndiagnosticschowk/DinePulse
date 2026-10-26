# DinePulse Implementation Status

Last updated: 2026-10-26

## Implemented in repository

| Phase | Scope | Repository status |
|---|---|---|
| 1–2 | Next.js/Express foundation, Supabase auth, memberships and roles | Existing implementation |
| 3–4 | PostgreSQL schema/RLS and menu management | Existing implementation |
| 5–6 | POS order flow, tables, billing/KOT numbering | Existing implementation; verify end-to-end |
| 7–8 | Inventory, recipes, suppliers, purchases and stock RPCs | Hardened migrations and UI/API are present; target database must be verified |
| 9 | Offline-ready POS | Browser menu cache, device-local queued drafts, reconnect retry, and idempotent server RPC added |
| 10 | Reporting | Branch-level sales report, daily trend, payment mix, best sellers and dashboard metrics added |
| 11 | Inventory RPC hardening | Draft PR #1; durable ledger and SQL contract assertions added; typecheck/build pass, lint baseline fails, staging migration/tests pending |
| 12 | Branch-aware analytics | Draft PR #2; branch selector, paid-order scoping, pagination and stale-response protection added; typecheck/build pass, lint baseline fails, staging tests pending |

## Phase 9 details

- Migration: `supabase/migrations/0005_phase9_offline_pos_and_reporting.sql`
- Adds `orders.client_order_id` with a branch-scoped unique index.
- Adds `create_pos_order` RPC that checks branch role, validates current menu availability, calculates server-side prices/tax, creates order lines in the same database transaction, and safely returns an existing order for duplicate client IDs.
- POS caches the last successful menu response and stores unsynced order drafts in browser local storage. Reconnect or the manual retry button attempts sync.
- Offline payment capture is not implemented. Offline queue is per-browser/device; clearing site data can erase unsynced drafts.

## Phase 10 details

- New page: `/reports`
- Range filters: 7, 30 and 90 days.
- Shows paid sales, paid order count, average bill, open order count, daily sales bars, completed payment mix, best-selling items, and recent orders.
- Dashboard summary cards now query live branch data for today's orders/sales, occupied/billing tables, and low-stock items.
- Reports are operational summaries, not a replacement for audited accounting exports.

## Current release gate (2026-10-26)

- Phase 11: the recipe-less consumption marker is now in the proposed migration, but do not apply `0011_phase11_inventory_rpc_hardening.sql` to production until the SQL contract assertions and behavioral inventory tests pass on a staging database matching the live schema.
- Phase 12: typecheck and build pass in CI, but lint still fails on existing app-wide errors; do not merge as production-complete until lint is resolved and multi-branch RLS, pagination, date-window and reconciliation tests pass.
- Phases 1–10 have implementation in the repository, but the checks below are still required before claiming production verification.

## Required manual/deployment steps

1. Review and apply Supabase migrations in the README order on a non-production project first, especially `0005_phase9_offline_pos_and_reporting.sql`.
2. Confirm the logged-in test user has an active branch membership with a supported role.
3. Run `npm run typecheck`, `npm run lint`, and `npm run build` from the repository root or confirm equivalent CI results.
4. Deploy the Express API separately and confirm `/api/v1/health`.
5. Set Netlify `NEXT_PUBLIC_API_URL` to the actual HTTPS API URL and redeploy the web app.
6. Execute the end-to-end checklist in README with a non-production branch.

## Verification honesty

GitHub Actions has confirmed typecheck and build pass for the latest Phase 11/12 branches, but lint still fails on existing web-app errors. The live Supabase migration, SQL contract test, and browser/staging end-to-end tests have **not** been run or independently confirmed. Do not mark the phases production-verified until those checks pass. Do not mark the phases production-verified until those checks pass.
