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
`supabase/tests/phase11_inventory_rpc_contracts.sql` contains read-only assertions for RPC signatures/return types, ledger-table existence/RLS/direct privileges, execute grants, and the branch-scoped unique purchase idempotency index required by concurrent retries.

Run it only against a disposable/staging Supabase database **after** migration 0011. It has not been executed in this run and does not replace behavioral integration tests.

## Latest CI follow-up (2026-10-30)
- The previous head commit's quality workflow run #108 passed typecheck, lint, and build.
- Added an assertion that `purchases` has a unique `(branch_id, idempotency_key)` index; a read-only live schema check confirmed `uq_purchases_branch_idempotency` exists.
- The new SQL assertion commit still needs its own workflow result.
- The live project still has no Supabase development branch. The ledger table and `create_purchase` RPC are absent from production, and migration history still lists only two records. Do not apply 0011 to production.

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
6. Confirm the unique `purchases(branch_id, idempotency_key)` index exists.
7. Test valid inventory adjustment, unauthorised user, wrong-branch user, cross-branch item ID, invalid movement type, and an attempt to reduce stock below zero.
8. Create and receive a purchase; verify inventory and stock movements change exactly once. Retry receiving it and verify no duplicate movements.
9. Attempt stock consumption for OPEN, SERVED, CANCELLED and REFUNDED orders; reject new consumption unless the order is `PAID`. A cashier may call the guarded RPC for a paid order but must not be able to call the general inventory-adjustment RPC.
10. Consume an order with recipe ingredients twice; stock must be deducted only once and the second call must return `0`.
11. Consume an order with no recipe/ingredients twice; the first call must write a ledger marker even with zero movements, and the second call must return `0`.
12. For an order already represented by legacy `ORDER` or `ORDER_CONSUMPTION` movement rows, confirm the RPC creates a ledger marker without deducting stock again.
13. Submit two concurrent purchase-create requests with the same branch and idempotency key; both responses must identify the same purchase, with one purchase row and one set of purchase items.
14. Confirm `received_by`, `stock_movements.created_by`, and ledger `consumed_by` always use `auth.uid()`, not caller-supplied user IDs.
15. Run root `npm run typecheck`, `npm run lint`, and `npm run build`; then exercise inventory endpoints against staging.
16. Review the Supabase security advisor and database logs before production rollout.

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

## Update (2026-10-30)
- Added a read-only contract assertion for the branch-scoped unique purchase idempotency index. The live database has `uq_purchases_branch_idempotency`, so the migration's concurrent retry path has the required uniqueness primitive on the inspected project.
- Latest completed quality runs #108 (before the SQL assertion update) passed typecheck, lint, and build. The new test commit's workflow is pending.
- The ledger table and `create_purchase` RPC remain absent from production; migration 0011 is still not applied. Phase 11 remains incomplete pending staging migration, SQL assertions, and behavioral tests.


## Daily verification update (2026-10-31)
- Latest PR-head GitHub Actions run #41002953671 completed successfully: root typecheck, ESLint, and production build passed.
- Read-only live schema inspection reconfirmed the branch-scoped unique purchase idempotency index and the live purchases / purchase_items columns referenced by migration 0011.
- Production still does not have order_stock_consumptions or the proposed create_purchase RPC; migration history still contains only two records. No migration was applied.
- Expanded SQL contract assertions now also check movement-direction enforcement, SECURITY INVOKER/DEFINER boundaries, the fixed search path on the ledger RPC, the ledger primary key, and audit actor attribution. The updated SQL test has not yet run against PostgreSQL.
- No Supabase staging branch exists. Creating one may incur compute charges and is intentionally not done automatically.

## Billing consistency blocker — implemented in this branch, staging pending
The earlier client-side sequence of separate payment, order-status, and stock-consumption writes has been replaced on this branch by the transactional settle_order_payment RPC. The RPC locks the order, validates branch role and outstanding balance, records an idempotent payment, marks the order PAID only when fully settled, and invokes stock consumption in the same transaction. The billing UI calls this single RPC.
The settlement function's dollar-quote delimiter was corrected on 2026-11-02 after source review found an invalid lone-dollar delimiter. This defect was not detected by TypeScript/ESLint/build CI because those jobs do not parse PostgreSQL migrations. Staging migration execution remains a hard release gate.

## Daily implementation update (2026-11-01)
- Fixed a confirmed live-schema compatibility issue: `stock_movements.quantity` has a CHECK constraint requiring a positive value. The RPCs still accept signed quantities to apply stock deltas, but now persist positive movement magnitudes; `movement_type` identifies the movement category.
- Added `payments.idempotency_key` and a unique `(order_id, idempotency_key)` index.
- Added `settle_order_payment`, a SECURITY DEFINER RPC with a fixed search_path. It locks the order, validates branch role and outstanding balance, writes the payment, marks the order PAID only when fully settled, and invokes stock consumption in the same transaction.
- Replaced the billing page's three separate client-side writes with the settlement RPC. The UI now shows the outstanding balance, uses the active saved branch when valid, disables duplicate clicks, and reuses a session idempotency key after an uncertain request.
- The settlement RPC also checks already-PAID legacy orders through the retry-safe stock-consumption ledger/legacy movement guard, allowing missing stock consumption to be repaired without a duplicate deduction.
- Added SQL contract assertions for positive movement magnitudes, the stock movement CHECK constraint, payment idempotency, settlement RPC signature/grants, order locking and atomic stock invocation.
- Latest previously completed PR-head CI runs #123 and #126 passed typecheck, ESLint and production build. The commits made in this update still require their own CI runs.
- No production migration or deployment was performed. The new migration changes have not been executed against staging; Phase 11 remains incomplete pending PostgreSQL contract and behavioral tests.

## Updated billing acceptance tests
1. A full payment inserts one completed payment, marks the order PAID, and consumes stock in the same transaction.
2. A stock failure rolls back the payment insert and order status update.
3. A repeated request with the same order/idempotency key returns the original payment without inserting another row.
4. Reusing a key with a different payment method or explicit amount is rejected.
5. A partial payment records only that amount and leaves the order billable with the correct remaining balance.
6. The final payment marks the order PAID and consumes stock exactly once.
7. A retry after a lost response returns the committed result; a cancelled/refunded order cannot be settled.
8. Concurrent payments for one order serialize on the order row and cannot over-collect beyond the outstanding balance.


## Daily implementation update (2026-11-02)
- Corrected the settlement function's PL/pgSQL dollar quoting from an invalid lone-dollar delimiter to a matching $ ... $ body.
- Pinned the inventory/purchase mutating RPCs to `search_path = pg_catalog, public` and expanded SQL contract assertions to require that trusted path for all five mutating RPCs.
- Bound the browser's pending payment idempotency key to the payment method. If a request outcome is uncertain, the user must retry with the same method; switching methods with the same key is blocked to avoid an idempotency mismatch or accidental second charge.
- Legacy raw-string session attempts from the earlier draft UI are not silently converted into a fresh key. The UI requests payment-history reconciliation before another payment is attempted.
- Added acceptance coverage requirements for same-method retry, different-method rejection, legacy/malformed pending attempt handling, and successful key cleanup.
- The migration and all SQL assertions still require execution on a schema-matched PostgreSQL staging database. No production migration or deployment was performed.

## Daily implementation update (2026-11-03)

- Re-inspection found the Phase 11 SQL contract test ended its `DO $$` block with a lone `$;`. Corrected the terminator to `$$;`; the prior Node typecheck/lint/build workflow did not parse SQL and therefore could not catch it.
- Added `scripts/validate_sql.py` using pglast and wired it into the quality workflow so all files under `supabase/migrations` and `supabase/tests` receive PostgreSQL statement-grammar validation on PR/push.
- The parser validates outer SQL statement grammar and dollar-quote framing; it does not execute migrations, resolve schema dependencies, or compile PL/pgSQL function bodies. Staging execution and behavioral tests remain mandatory.
- Fixed the billing success path so a committed settlement followed by a failed order-list refresh is reported as a saved payment with a refresh warning, not as a failed payment that the cashier might submit again.
- Rechecked the previously pending PR-head workflow run #159: it completed successfully. The new commits from 2026-11-03 require their own workflow runs.
- No production migration, deployment, or change to `main` was made.

## Final CI verification (2026-11-03)
- PR-head GitHub Actions run #174 completed successfully: pglast parsed all 8 SQL files (6 historical migrations, migration 0011, and the Phase 11 contract test) with zero parser failures; typecheck, ESLint, and production build also passed.
- Netlify deploy preview is successful for the current PR head.
- The parser catches outer SQL grammar and dollar-quote framing, but does not execute PL/pgSQL function bodies or validate live schema dependencies.
- Migration 0011 and the read-only contract assertions remain unexecuted against a schema-matched staging database. Phase 11 is still incomplete.


## 2026-11-04 regression check
- An unpaid order that already has a legacy `ORDER`/`ORDER_CONSUMPTION` stock movement must still be rejected by `consume_order_stock`; it must not receive a durable consumption marker before the PAID guard.
- Verify the PAID-state guard occurs before the legacy movement-only backfill check in the deployed function definition.
- After payment settles, retrying consumption for the paid order must either perform the full deduction once or safely recognize a previously completed legacy consumption.


## Daily implementation update (2026-11-05)
- Added an explicit amount field to Billing. Blank means collect the full outstanding balance; a valid positive amount up to the current due supports a partial payment.
- The browser pending-attempt record now binds the idempotency key to both payment method and normalized two-decimal amount. A retry after an uncertain response must use the same method and amount; legacy records without an amount continue to mean the full-balance request used by earlier UI versions.
- After the settlement RPC confirms commit, the pending key and amount input are cleared. A subsequent order-list refresh failure is still reported as a refresh issue, never as a failed charge.
- Manual/CI acceptance gates added: blank full-balance payment, partial amount, zero/negative/over-due/over-precision rejection, same-method/same-amount retry, changed-method/changed-amount rejection, and post-commit refresh failure.
- The UI passes `p_amount` to the existing `settle_order_payment` RPC; no database schema change was made in this update.
- Production still lacks the Phase 11 ledger/payment idempotency objects and RPCs. Do not deploy this UI against production until migration 0011 has been applied and validated on a schema-matched staging database.


## 2026-11-05 server-side idempotency hardening
- The settlement RPC now reconstructs the outstanding balance before the existing payment row (excluding that row) when a retry uses `p_amount = NULL`. This binds a full-balance retry to the same amount that was due when the original payment committed.
- Explicit partial-amount retries must match the original payment amount; retries also require the original row to remain COMPLETED and the normalized reference number to match.
- Added a read-only SQL contract assertion against `pg_get_functiondef` for amount-mode, reference-number and completed-status checks.
- This closes the server-side gap as well as the browser-side method/amount binding; no extra schema column was required.
- The new migration and contract-test commits require their own PostgreSQL grammar/CI run. Staging execution and behavioral concurrency/retry tests remain pending.


## Daily implementation update (2026-11-06)
- Hardened `settle_order_payment` at the database boundary: explicit amounts must be positive, finite numeric values and have no more than two decimal places. This prevents direct RPC/PostgREST callers from bypassing the Billing UI's two-decimal validation and relying on an implicit numeric(12,2) rounding during settlement.
- Added a read-only SQL contract assertion requiring both the precision check and explicit rejection of PostgreSQL numeric special values (`NaN`, `Infinity`, `-Infinity`).
- Staging acceptance cases: accept `125.50`; reject `125.505`, zero, negative, `NaN`, `Infinity`, and `-Infinity`; confirm rejected calls create no payment and do not change order/stock state.
- No production migration was applied. The change is committed only to the Phase 11 PR branch; migration execution and transactional behavior still require a schema-matched disposable/staging database.

## Daily security hardening update (2026-11-07)
- Added trusted search_path = pg_catalog, public settings to set_updated_at, get_current_user_id, complete_workspace_onboarding, user_has_branch_access, user_has_branch_role, user_has_company_access, and user_is_branch_owner_or_admin.
- Revoked default/public and anon EXECUTE from the five exposed SECURITY DEFINER onboarding/access helpers while explicitly retaining authenticated EXECUTE because RLS policies and authenticated application flows call them. The event-trigger function rls_auto_enable is intentionally not changed in this migration; its event-trigger behavior and ACL need separate verification.
- Expanded the Phase 11 SQL contract test to assert the fixed helper search paths, deny anonymous helper execution, and preserve authenticated execution. The test's closing DO $$ delimiter is explicitly checked by the PostgreSQL parser.
- New production authorization blocker: live public.orders_write is FOR ALL for authenticated, with USING and WITH CHECK based only on user_has_branch_access(branch_id). This is broader than operation-specific role permissions. Before production, map all POS, waiter, cashier and kitchen order-write paths, then split the policy into least-privilege operation/role policies and test role denial in staging. Do not change it blindly because legitimate order/KOT workflows may depend on current writes.
- Live orders, order_items, payments, purchases and stock_movements counts are all currently zero, so acceptance tests need seeded staging fixtures rather than relying on production data.
- The prior shared documentation workflow #224 passed all quality steps. Today's migration/test commits require their own workflow run; PostgreSQL staging execution remains pending.
- No production DDL, deployment or main change was made.
