# Phase 11 — Inventory RPC hardening

## Scope
- Preserve the live database RPC names, argument signatures, and return types.
- Require an authenticated branch member with an allowed inventory-management role inside each stock-mutating RPC, not only in Express middleware.
- Reject invalid movement types, zero quantities, cross-branch inventory IDs, and stock reductions below zero.
- Enforce signed quantity consistency in both API and RPC: PURCHASE/ADJUSTMENT_IN require positive quantities; SALE/WASTE/ADJUSTMENT_OUT require negative quantities. RETURN remains direction-flexible pending confirmed product semantics.
- Permit CASHIER to consume recipe stock only through the guarded order-consumption RPC, and only after the order is PAID; the general inventory-adjustment RPC remains manager-only.
- Make order stock consumption retry-safe with a durable ledger, including orders with no recipe ingredients.
- Backfill the ledger marker when legacy `ORDER` or `ORDER_CONSUMPTION` movement rows already exist.
- Add the missing `create_purchase` RPC contract used by the API.
- Remove anonymous/public execute grants from the four inventory/purchase RPCs while retaining authenticated execution.

## Migration
`supabase/migrations/0011_phase11_inventory_rpc_hardening.sql`

This is a forward-only migration and intentionally does not rewrite old migration files. It has **not** been applied to production.

## Automated database contract test
`supabase/tests/phase11_inventory_rpc_contracts.sql` contains read-only assertions for RPC signatures/return types, ledger-table existence/RLS/direct privileges, and execute grants.

Run it only against a disposable/staging Supabase database **after** migration 0011. It has not been executed in this run and does not replace behavioral integration tests.

## Latest CI follow-up (2026-10-27)

- Latest completed Phase 11 quality workflow run #79: typecheck **passed**, lint **passed**, and build **passed**.
- Netlify deploy preview for PR #1: **success**.
- The lint/type issues in billing, inventory, kitchen, orders, POS, suppliers and tables were fixed with explicit row/response types and deferred effect initialization.
- CI build uses non-secret placeholder Supabase public environment values; these are for compilation only and are not deployment credentials.
- Read-only SQL contract assertions are committed but **not executed**. No Supabase development branches are listed, and no staging database migration or behavioral inventory tests have been run.

## Required verification before production
1. Apply the migration to a disposable/staging database matching the inspected live schema.
2. Run `supabase/tests/phase11_inventory_rpc_contracts.sql` and confirm it passes.
3. Confirm all four RPC signatures and return types match the API:
   - `adjust_inventory_stock(uuid,uuid,numeric,text,text,uuid,text,uuid) returns stock_movements`
   - `create_purchase(uuid,uuid,uuid,text,date,numeric,text,numeric,text,jsonb,text) returns jsonb`
   - `receive_purchase(uuid,uuid,uuid) returns purchases`
   - `consume_order_stock(uuid,uuid,uuid) returns integer`
4. Confirm `anon` cannot execute these RPCs and `authenticated` can execute them.
5. Confirm `order_stock_consumptions` has RLS enabled and no direct table privileges for `anon` or `authenticated`; only the guarded RPC can write markers.
6. Test valid inventory adjustment, unauthorised user, wrong-branch user, cross-branch item ID, invalid movement type, and an attempt to reduce stock below zero.
7. Create and receive a purchase; verify inventory and stock movements change exactly once. Retry receiving it and verify no duplicate movements.
8. Attempt stock consumption for OPEN, SERVED, CANCELLED and REFUNDED orders; reject new consumption unless the order is `PAID`. A cashier may call the guarded RPC for a paid order but must not be able to call the general inventory-adjustment RPC.
9. Consume an order with recipe ingredients twice; stock must be deducted only once and the second call must return `0`.
10. Consume an order with no recipe/ingredients twice; the first call must write a ledger marker even with zero movements, and the second call must return `0`.
11. For an order already represented by legacy `ORDER` or `ORDER_CONSUMPTION` movement rows, confirm the RPC creates a ledger marker without deducting stock again.
12. Submit two concurrent purchase-create requests with the same branch and idempotency key; both responses must identify the same purchase, with one purchase row and one set of purchase items.
13. Confirm `received_by`, `stock_movements.created_by`, and ledger `consumed_by` always use `auth.uid()`, not caller-supplied user IDs.
14. Run root `npm run typecheck`, `npm run lint`, and `npm run build`; then exercise inventory endpoints against staging.
15. Review the Supabase security advisor and database logs before production rollout.

## Live-project findings (2026-10-26)
- No Supabase development branches are currently listed for the project, so staging validation remains blocked unless a disposable/staging database is provided.
- The production migration history currently lists only two migration records despite later schema objects being present. Do not blindly replay historical migrations.
- The security advisor still reports six SECURITY DEFINER functions callable by `anon` and/or `authenticated`, two mutable function search paths, and disabled leaked-password protection. These findings require function-by-function review; do not blindly revoke grants because onboarding and membership helper behavior may depend on them.

## Update (2026-10-28)
- Added API and SQL guards to reject movement signs that contradict PURCHASE, ADJUSTMENT_IN, SALE, WASTE, and ADJUSTMENT_OUT labels.
- Added a staging acceptance item for movement direction. The new quality workflow runs are currently in progress; this code has not been tested against PostgreSQL yet.

## Completion status
The code-level recipe-less retry gap has been addressed by adding `order_stock_consumptions`, revoking direct table privileges, enabling RLS, validating authentication/branch role in the consumption RPC, and using a fixed search path. The migration, permissions, and API flows have **not** been executed against staging. Phase 11 remains incomplete until the SQL assertions compile and every behavioral checklist item passes.


## Update (2026-10-29)
- Latest completed GitHub Actions quality runs #95 (Phase 11) and #96 (Phase 12) passed typecheck, lint and build.
- Added a PAID-order guard to new stock consumption and a guarded CASHIER path for billing-triggered recipe consumption. The general stock-adjustment RPC remains manager-only.
- The guarded consumption RPC now updates inventory and inserts the linked SALE movement in the same database transaction rather than calling the manager-only general adjustment RPC.
- The migration and SQL source-contract assertions have not been executed against PostgreSQL staging. Behavioral tests remain a release blocker.
