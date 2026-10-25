# Phase 11 — Inventory RPC hardening

## Scope
- Preserve the live database RPC names, argument signatures, and return types.
- Require an authenticated branch member with an allowed inventory-management role inside each stock-mutating RPC, not only in Express middleware.
- Reject invalid movement types, zero quantities, cross-branch inventory IDs, and stock reductions below zero.
- Make order stock consumption retry-safe with a durable ledger, including orders with no recipe ingredients.
- Backfill the ledger marker when legacy `ORDER` or `ORDER_CONSUMPTION` movement rows already exist.
- Add the missing `create_purchase` RPC contract used by the API.
- Remove anonymous/public execute grants from the four inventory/purchase RPCs while retaining authenticated execution.

## Migration
`supabase/migrations/0011_phase11_inventory_rpc_hardening.sql`

This is a forward-only migration and intentionally does not rewrite old migration files. It has **not** been applied to production.

## Required verification before production
1. Apply the migration to a disposable/staging database matching the inspected live schema.
2. Confirm all four RPC signatures and return types match the API:
   - `adjust_inventory_stock(uuid,uuid,numeric,text,text,uuid,text,uuid) returns stock_movements`
   - `create_purchase(uuid,uuid,uuid,text,date,numeric,text,numeric,text,jsonb,text) returns jsonb`
   - `receive_purchase(uuid,uuid,uuid) returns purchases`
   - `consume_order_stock(uuid,uuid,uuid) returns integer`
3. Confirm `anon` cannot execute these RPCs and `authenticated` can execute them.
4. Confirm `order_stock_consumptions` has RLS enabled and no direct table privileges for `anon` or `authenticated`; only the guarded RPC can write markers.
5. Test valid inventory adjustment, unauthorised user, wrong-branch user, cross-branch item ID, invalid movement type, and an attempt to reduce stock below zero.
6. Create and receive a purchase; verify inventory and stock movements change exactly once. Retry receiving it and verify no duplicate movements.
7. Consume an order with recipe ingredients twice; stock must be deducted only once and the second call must return `0`.
8. Consume an order with no recipe/ingredients twice; the first call must write a ledger marker even with zero movements, and the second call must return `0`.
9. For an order already represented by legacy `ORDER` or `ORDER_CONSUMPTION` movement rows, confirm the RPC creates a ledger marker without deducting stock again.
10. Submit two concurrent purchase-create requests with the same branch and idempotency key; both responses must identify the same purchase, with one purchase row and one set of purchase items.
11. Confirm `received_by`, `stock_movements.created_by`, and ledger `consumed_by` always use `auth.uid()`, not caller-supplied user IDs.
12. Run root `npm run typecheck`, `npm run lint`, and `npm run build`; then exercise inventory endpoints against staging.
13. Review the Supabase security advisor and database logs before production rollout.

## Completion status
The code-level recipe-less retry gap has been addressed by adding `order_stock_consumptions`, revoking direct table privileges, enabling RLS, validating authentication/branch role in the consumption RPC, and using a fixed search path. The migration, permissions, and API flows have **not** been executed against staging. Phase 11 remains incomplete until the migration compiles and every checklist item passes.
