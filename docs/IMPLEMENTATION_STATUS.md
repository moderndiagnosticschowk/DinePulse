# DinePulse Implementation Status

Last updated: 2026-11-06

## Phase review

| Phase | Scope | Repository status |
|---|---|---|
| 1–2 | Next.js/Express foundation, Supabase auth, memberships and roles | Existing implementation; end-to-end authentication/role tests still required |
| 3–4 | PostgreSQL schema/RLS and menu management | Existing implementation; live policy behavior requires verification |
| 5–6 | POS order flow, tables, billing/KOT numbering | Existing implementation; verify order-to-kitchen-to-payment flow |
| 7–8 | Inventory, recipes, suppliers, purchases and stock RPCs | UI/API present; Phase 11 hardening and live RPC compatibility still require staging validation |
| 9 | Offline-ready POS | Browser menu cache, device-local queued drafts, reconnect retry and idempotent server RPC present; offline payment capture is not implemented |
| 10 | Reporting | Base sales, daily trend, payment mix, best sellers and dashboard metrics present; financial reconciliation still required |
| 11 | Inventory RPC security, stock reliability and atomic billing | Draft PR #1; adds movement validation, purchase/payment idempotency, durable consumption ledger, atomic full/partial settlement, server-side retry binding and two-decimal finite-amount enforcement. PR-head quality run #42161314549 passed; PostgreSQL staging/behavior tests remain pending |
| 12 | Branch-aware reports and financial analytics | Draft PR #2; adds branch-scoped pagination, payment-time attribution, current open-order KPI, branch-relation normalization and INR paise-accurate aggregation. Code-fix run #219 passed; docs follow-up run #221 was still building at last check. Staging isolation/reconciliation remain pending |

## Phase 9 details

- Migration: `supabase/migrations/0005_phase9_offline_pos_and_reporting.sql`
- Adds `orders.client_order_id` with a branch-scoped unique index.
- Adds `create_pos_order` RPC that checks branch role, validates current menu availability, calculates server-side prices/tax, creates order lines in one transaction, and returns an existing order for duplicate client IDs.
- POS caches the last successful menu response and stores unsynced order drafts in browser local storage. Reconnect or manual retry attempts sync.
- Offline payment capture is not implemented. The queue is per browser/device; clearing site data can erase unsynced drafts.

## Phase 11 release gate

- Migration: `supabase/migrations/0011_phase11_inventory_rpc_hardening.sql`
- Contract assertions: `supabase/tests/phase11_inventory_rpc_contracts.sql`
- The settlement RPC rejects non-positive, non-finite and over-two-decimal explicit amounts before writing payments.
- New stock consumption is restricted to PAID orders. Authorized CASHIER members can use the guarded consumption RPC from billing; general stock adjustment remains manager-only.
- Do not apply to production until migration and SQL contracts pass on a schema-matched disposable/staging database, followed by role denial, cross-branch, purchase/payment idempotency, partial/full payment, stock rollback, legacy-order repair and browser retry tests.

## Phase 12 release gate

- Report security preflight: `supabase/tests/phase12_report_security_contracts.sql`
- Sales/daily trends use `orders.paid_at`; payment mix uses each completed `payments.paid_at`; recent orders and current open-order counts use their operational timestamps/statuses.
- INR report values now display two decimals and aggregate using integer paise in `apps/web/lib/report-money.mjs`; unit tests run in the quality workflow.
- Do not mark complete until migration 0012 and SQL preflight pass on staging, then two-branch RLS isolation, 500+ row pagination, payment-date boundaries, report-total reconciliation, open-order KPI, relation-shape and EXPLAIN/ANALYZE tests pass.

## Live-project findings (read-only checks, 2026-11-06)

- Supabase project `ylzwwojveufntysehvkl` is ACTIVE_HEALTHY on PostgreSQL 17.11.
- Migration history lists only `20261007155044` and `20261007155110`, although the live schema contains additional objects. Do not blindly replay historical migrations.
- No Supabase development branches are listed. Creating one can incur compute charges; no branch was created.
- Production does not yet contain `order_stock_consumptions`, `payments.idempotency_key`, `create_purchase`, `settle_order_payment`, or the four report indexes from migration 0012. Production migration/deployment was not performed.
- Security advisor findings: six SECURITY DEFINER helpers are executable by anon and authenticated roles and need function-by-function review; two functions have mutable search paths; leaked-password protection is disabled. Do not blindly revoke grants needed by onboarding/membership flows.
- Performance advisor findings: 27 unindexed foreign-key warnings, four RLS initialization-plan warnings, 15 multiple-permissive-policy warnings, and 10 unused-index notices. Prioritize using query plans/workload evidence; do not blindly drop indexes or rewrite RLS policies.

## Required manual/deployment steps

1. Arrange a schema-matched disposable/staging Supabase environment; confirm any development-branch compute cost before creating one.
2. Run Phase 11 migration 0011 and its SQL contract/behavioral tests on staging.
3. Run Phase 12 migration 0012 and its SQL preflight, two-branch isolation, pagination, reconciliation and query-plan tests on staging.
4. Run root `npm run typecheck`, `npm run lint`, and `npm run build` on the latest PR heads.
5. Deploy the Express API separately and confirm `/api/v1/health`.
6. Set Netlify `NEXT_PUBLIC_API_URL` to the actual HTTPS API URL and deploy only after release approval.
7. Execute the README end-to-end checklist with non-production users/branches.

## Verification honesty

GitHub Actions proves SQL statement parsing, unit checks where configured, TypeScript, ESLint and production build only for the exact commit/run shown. It does not prove PostgreSQL migration execution, RLS row isolation, payment/stock transaction behavior or financial reconciliation. PR #1 and PR #2 remain open Drafts; `main` and production database are unchanged.


## Daily verification update (2026-11-10)
- Phase 11: production catalog review found `rls_auto_enable()` is a SECURITY DEFINER `event_trigger` function bound to the enabled `ensure_rls` DDL event trigger. Migration 0011 now revokes direct EXECUTE from PUBLIC/anon/authenticated while retaining the registered database event trigger. Contract tests assert the event trigger binding remains enabled and client roles cannot execute the function.
- Phase 12: added leap-day and year-boundary daily-bucket regression coverage. Schema review found `branches` has no timezone column and report UTC bounds/day grouping currently use the browser timezone. This is documented as a limitation; use `Asia/Kolkata` consistently for the current India rollout and add branch IANA timezone support before multi-timezone expansion.
- Both PRs remain Draft. No production migration or main-branch change was made. Staging migration execution and behavioral acceptance remain mandatory.

## Daily implementation update (2026-11-11)
- Phase 12 (2026-11-11): report query boundaries, daily sales buckets and recent-order display now use `Asia/Kolkata` through a reusable IANA-timezone utility, independent of the browser timezone. Added tests for midnight attribution, UTC boundaries, invalid zones, leap day and year boundary. Branch-level timezone persistence remains a pre-multi-timezone requirement because the current `branches` table has no timezone column.


### Daily implementation update (2026-11-11 — timezone schema correction)
- Read-only Supabase schema inspection found that `companies.timezone` already exists with default `Asia/Kolkata`, and `branches.company_id` references `companies.id`. The report page now loads the selected branch's related company timezone rather than relying on a hardcoded India timezone or browser timezone.
- Added object/array/null/invalid company-timezone resolution tests. Branch-specific timezone overrides remain a future schema enhancement only if branches under the same company need different timezones.
- The first timezone CI run failed because the new date-key regex was over-escaped; that was corrected, and the latest head is being revalidated. Do not treat the earlier failed run as the final result.


### Daily implementation update (2026-11-11 — report typing)
- Added TypeScript declarations for the timezone utility and updated the aggregation helper declaration for its optional timezone parameter.
- Report suite now has 16 tests (5 currency + 11 aggregation/timezone). Prior workflow #321 passed the 15 tests in its commit but failed typecheck/build due to missing declarations; the declarations are now in the PR branch and require a fresh full CI pass.
