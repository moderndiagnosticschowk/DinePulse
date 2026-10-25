# Phase 11 — Inventory RPC hardening

## Scope
- Preserve the live database RPC names, argument signatures, and return types.
- Require an authenticated branch member with an allowed inventory-management role inside each stock-mutating RPC, not only in Express middleware.
- Reject invalid movement types, zero quantities, cross-branch inventory IDs, and stock reductions below zero.
- Make order stock consumption retry-safe with a durable, branch-scoped ledger, including orders with no recipe ingredients; backfill the marker when legacy movement rows already exist.
- Add the missing `create_purchase` RPC contract used by the API.
- Remove anonymous/public execute grants from the four inventory/purchase RPCs while retaining authenticated execution.

## Migration
`supabase/migrations/0011_phase11_inventory_rpc_hardening.sql`

This is a forward-only migration and intentionally does not rewrite old migration files. It has **not** been applied to production as part of this branch.

## Required verification before production
1. Apply the migration to a disposable/staging database that matches the live schema.
2. Confirm the four RPC signatures and return types still match the API:
   - `adjust_inventory_stock(uuid,uuid,numeric,text,text,uuid,text,uuid) returns stock_movements`
   - `create_purchase(uuid,uuid,uuid,text,date,numeric,text,numeric,text,jsonb,text) returns jsonb`
   - `receive_purchase(uuid,uuid,uuid) returns purchases`
   - `consume_order_stock(uuid,uuid,uuid) returns integer`
3. Confirm `anon` cannot execute these RPCs and `authenticated` can execute them.
4. Confirm `order_stock_consumptions` has RLS enabled and no direct table privileges for `anon`/`authenticated`; only the guarded RPC can write markers.\n5. Test a valid inventory manager adjustment, an unauthorised user, a user from a different branch, a cross-branch item ID, an invalid movement type, and an attempt to reduce stock below zero.
6. Create and receive a purchase; verify inventory and stock movements change exactly once. Retry receiving it and verify no duplicate movements.
7. Consume an order with recipe ingredients twice; stock must be deducted only once and the second call must return `0`.\n8. Consume an order with no recipe/ingredients twice; the first call must write a ledger marker even with zero movements, and the second call must return `0`.\n9. For an order already represented by legacy `ORDER` or `ORDER_CONSUMPTION` movement rows, confirm the RPC creates a ledger marker without deducting stock again.
10. Submit two concurrent purchase-create requests with the same branch and idempotency key; both responses must identify the same purchase, with one purchase row and one set of purchase items.
11. Confirm `received_by`, `stock_movements.created_by`, and the ledger's `consumed_by` always use `auth.uid()` rather than caller-supplied user IDs.
12. Run root `npm run typecheck`, `npm run build`, and `npm run lint`; then exercise the inventory endpoints against staging.
13. Review the Supabase security advisor and database logs before production rollout.

## Implementation note / verification blocker
The migration now adds `order_stock_consumptions`, a durable marker written even when an order has no recipe ingredients. Direct table privileges are revoked and RLS is enabled; the order-consumption RPC uses a fixed search path and validates authentication/branch role before touching the ledger. Existing `ORDER` and legacy `ORDER_CONSUMPTION` movements are recognized and backfilled into the ledger without a second deduction. This closes the code-level recipe-less retry gap, but the migration and privilege model have **not** been executed against staging yet. Do not claim Phase 11 complete until the migration compiles and every checklist item passes.
