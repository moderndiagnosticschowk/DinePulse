# DinePulse — Restaurant POS

DinePulse is a Next.js + Express + Supabase restaurant operations app for branch-scoped POS billing, KOT, tables, menu management, inventory, purchasing and reports.

## Architecture

- **Web:** Next.js App Router, React, TypeScript, Tailwind CSS (`apps/web`)
- **API:** Express + TypeScript (`apps/api`), deployed separately from Netlify
- **Auth/database:** Supabase Auth + PostgreSQL + Row Level Security
- **Branch security:** branch membership and role checks; never use a service-role key in the browser

## Current phases

- **Phases 1–4:** foundation, Supabase auth/roles, database/RLS, menu management
- **Phases 5–6:** POS orders, order/KOT numbering, tables and billing flows
- **Phases 7–8:** inventory, recipes, suppliers, purchases, stock movement RPCs and idempotent receiving
- **Phase 9:** local POS menu cache, device-local offline order queue and idempotent retry/sync
- **Phase 10:** branch-level sales reports, daily trend, payment mix, best-selling items and live dashboard metrics

See [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) for what is implemented and what still requires deployment/database verification.

## Run locally

Use Node.js 22 or later from the repository root:

~~~bash
npm install
npm run dev -w apps/web
npm run dev -w apps/api
~~~

The Express API needs its own `apps/api/.env` populated from `apps/api/.env.example`. The web app needs its environment values from `apps/web/.env.example`. Never commit secrets.

## Supabase migrations

For a **fresh database**, apply these SQL files in the listed order from Supabase SQL Editor or your chosen migration workflow:

1. `supabase/migrations/0001_phase2_auth.sql`
2. `supabase/migrations/0002_phase3_database_phase4_menu.sql`
3. `supabase/migrations/0003_phase5_6_pos_billing_kot.sql`
4. `supabase/migrations/0003_phase7_phase8_inventory_purchase_hardening.sql`
5. `supabase/migrations/0004_phase7_8_inventory_purchases.sql`
6. `supabase/migrations/0005_phase9_offline_pos_and_reporting.sql`

The two `0003` files are separate migrations with distinct filenames; apply both. Migration 0004 is intentionally additive and does not redefine the hardened RPC functions. **Do not blindly re-run old SQL against production.** Back up the database and review the current function definitions before applying changes to a live project.

Phase 9 offline sync requires migration 0005. Until that migration is applied, the POS cannot successfully sync queued orders because the `create_pos_order` RPC and `client_order_id` column will not exist.

## Netlify web deployment

Netlify builds the web app from `apps/web`. Configure these environment variables in Netlify for each relevant deploy context:

- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Supabase publishable key (not a service-role key)
- `NEXT_PUBLIC_API_URL`: public HTTPS URL of the separately deployed Express API, without a trailing slash

## Express API deployment

Deploy `apps/api` as a separate Node web service (for example, Render). Keep the repository root as the service root for this npm-workspaces monorepo.

Build command:

~~~bash
npm install && npm run build -w apps/api
~~~

Start command:

~~~bash
node apps/api/dist/server.js
~~~

Set server-side environment variables such as `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `CORS_ORIGIN` (the exact Netlify site origin), and any optional Resend settings. Let the host provide `PORT`. Confirm `/api/v1/health` responds after deployment, then set `NEXT_PUBLIC_API_URL` in Netlify and trigger a fresh web deploy.

## Offline POS boundaries

- The menu cache and unsynced order queue are stored in the browser's local storage on that device.
- Order retries use a stable client order ID so retrying after a timeout does not create a duplicate order.
- The server validates menu item availability and current prices when queued orders sync; displayed offline estimates can change if menu prices change.
- Payments are **not** collected offline. Keep the device signed in and use a trusted device; clearing browser storage can remove unsynced drafts.
- Apply migration 0005 before testing offline queue sync. Verify with a non-production branch first.

## Verification checklist

Run from the repository root:

~~~bash
npm run typecheck
npm run lint
npm run build
~~~

Then verify in a non-production Supabase branch:

1. Sign in and open a branch with an active membership.
2. Create a POS order online; confirm it appears once in Orders/KOT.
3. Retry the same client order ID and confirm no duplicate order/items are created.
4. Disconnect the device, create a queued order, reconnect, and confirm it syncs once.
5. Check branch isolation and ensure an unavailable/cross-branch menu item is rejected.
6. Confirm reports show paid sales and that payment totals match completed payment records.
7. Receive a purchase twice and consume stock twice; the second attempt must not duplicate stock movements.

A successful GitHub commit or hosting build does not by itself prove a migration has been applied or that end-to-end behavior is correct.
