# DinePulse Implementation Status

Last updated: 2026-10-29

## Phase review

| Phase | Scope | Repository status |
|---|---|---|
| 1–2 | Next.js/Express foundation, Supabase auth, memberships and roles | Existing implementation; end-to-end authentication/role tests still required |
| 3–4 | PostgreSQL schema/RLS and menu management | Existing implementation; live policy behavior requires verification |
| 5–6 | POS order flow, tables, billing/KOT numbering | Existing implementation; verify order-to-kitchen-to-payment flow |
| 7–8 | Inventory, recipes, suppliers, purchases and stock RPCs | UI/API present; Phase 11 RPC hardening is still pending staging validation |
| 9 | Offline-ready POS | Browser menu cache, device-local queued drafts, reconnect retry and idempotent server RPC present; offline payment capture is not implemented |
| 10 | Reporting | Base sales, daily trend, payment mix, best sellers and dashboard metrics present |
| 11 | Inventory RPC security and stock reliability | Draft PR #1; movement-sign validation, purchase idempotency, durable consumption ledger and paid-order stock guard added; latest CI run #101 was in progress; staging SQL/behavior tests pending |
| 12 | Branch-aware analytics | Draft PR #2; branch selector, pagination, stale-response protection and payment-time sales attribution added; previous CI #96 passed, newer runs #103/#105 were in progress; staging reconciliation/isolation tests pending |

## Phase 9 details

- Migration: `supabase/migrations/0005_phase9_offline_pos_and_reporting.sql`
- Adds `orders.client_order_id` with a branch-scoped unique index.
- Adds `create_pos_order` RPC that checks branch role, validates current menu availability, calculates server-side prices/tax, creates order lines in one transaction, and returns an existing order for duplicate client IDs.
- POS caches the last successful menu response and stores unsynced order drafts in browser local storage. Reconnect or manual retry attempts sync.
- Offline payment capture is not implemented. The queue is per browser/device; clearing site data can erase unsynced drafts.

## Phase 11 release gate

- Migration: `supabase/migrations/0011_phase11_inventory_rpc_hardening.sql`
- Contract assertions: `supabase/tests/phase11_inventory_rpc_contracts.sql`
- New stock consumption is restricted to PAID orders. Authorized CASHIER members can use the guarded consumption RPC from billing; general stock adjustment remains manager-only.
- Do not apply the migration to production until it compiles and passes SQL contract, role-denial, movement-sign, negative-stock, purchase-retry, paid-order, cashier-billing, and recipe-based/recipe-less idempotency tests on a staging database matching the live schema.

## Phase 12 release gate

- Report security preflight: `supabase/tests/phase12_report_security_contracts.sql`
- Sales and daily trends use `paid_at`; recent orders/open-order counts use `created_at`.
- Do not mark complete until the latest quality checks pass and staging verifies two-branch RLS isolation, 500+ row pagination, payment-date boundaries, report-total reconciliation, and stale-response behavior.

## Live-project findings (read-only checks, 2026-10-29)

- Supabase migration history lists only two records although the live schema contains additional objects. Do not blindly replay historical migrations.
- No Supabase development branches are listed. Staging migration and behavioral database tests remain blocked until a suitable disposable/staging environment is available.
- Security advisor findings: six SECURITY DEFINER functions are executable by anon/authenticated and need function-by-function review; two functions have mutable search paths; leaked-password protection is disabled. Do not blindly revoke grants that onboarding or membership flows may require.
- Performance advisor findings include 27 unindexed foreign-key warnings, four RLS initialization-plan warnings, 15 multiple-permissive-policy warnings, and 10 unused-index notices. Prioritize with query plans/workload evidence; do not blindly drop indexes or rewrite RLS policies.

## Required manual/deployment steps

1. Arrange a disposable/staging Supabase environment that matches the inspected live schema; do not assume migration history is complete.
2. Run the relevant Phase 11/12 SQL contract scripts against staging.
3. Run root `npm run typecheck`, `npm run lint`, and `npm run build` on the latest commits.
4. Deploy the Express API separately and confirm `/api/v1/health`.
5. Set Netlify `NEXT_PUBLIC_API_URL` to the actual HTTPS API URL and deploy only after release approval.
6. Execute the end-to-end README checklist with non-production users/branches.

## Verification honesty

GitHub Actions runs #95 and #96 passed typecheck, lint and build on earlier commits. Newer Phase 11/12 commits triggered runs #101, #103 and #105, which were still in progress at the last check. No Phase 11 migration or Phase 12 SQL/browser acceptance tests have been confirmed on staging. Neither PR is merged; `main` and the production database remain unchanged.
