# Phase 11 — Inventory RPC hardening

## Scope
- Preserve the live database RPC names, argument signatures, and return types.
- Require an authenticated branch member with an allowed inventory-management role inside each stock-mutating RPC, not only in Express middleware.
- Reject invalid movement types, zero quantities, cross-branch inventory IDs, and stock reductions below zero.
- Make order stock consumption retry-safe when at least one consumption movement has already been recorded.
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
4. Test a valid inventory manager adjustment, an unauthorised user, a user from a different branch, a cross-branch item ID, an invalid movement type, and an attempt to reduce stock below zero.
5. Create and receive a purchase; verify inventory and stock movements change exactly once. Retry receiving it and verify no duplicate movements.
6. Consume order stock with a recipe, retry the same order, and verify stock is not deducted twice.
7. Run root `npm run typecheck`, `npm run build`, and `npm run lint`; then exercise the inventory endpoints against staging.
8. Review the Supabase security advisor and database logs before production rollout.

## Known limitation
The order-consumption idempotency guard relies on the presence of at least one `ORDER` stock movement. Orders without recipe ingredients create no movement and therefore have no consumption marker. Consider a dedicated consumption ledger or an order-level consumed timestamp in a separately reviewed migration if recipe-less orders need a durable marker.
