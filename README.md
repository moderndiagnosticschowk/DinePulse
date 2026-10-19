# Smart Restaurant POS — Phase 1 + 2 + 3 + 4

Production-oriented restaurant POS foundation built with Next.js, Express and Supabase.

## Completed in this package

### Phase 1 — Foundation
- Next.js App Router + TypeScript + Tailwind
- Express API
- Environment validation
- Application shell and protected route architecture
- Central API response/error pattern

### Phase 2 — Auth & Roles
- Supabase email/password auth
- Workspace onboarding
- Company/branch/user membership model
- OWNER/ADMIN/MANAGER/CASHIER/WAITER/KITCHEN/INVENTORY_MANAGER roles
- Auth-aware API middleware

### Phase 3 — Database + RLS
- Core restaurant tables
- Menu, modifiers, categories
- Orders, order items and payments
- Inventory, recipes, stock movement
- Suppliers, purchases, expenses
- Printers, settings, audit logs
- Branch-scoped RLS
- Updated-at triggers
- Default menu category seeding during onboarding

### Phase 4 — Menu Management
- Menu categories
- Menu items
- Modifier management
- Price/cost/tax fields
- Veg/non-veg
- Availability/active status
- Item → modifier assignments
- Real Express + Supabase CRUD API
- Branch header enforcement
- Functional Menu UI

## Run

```bash
npm install
npm run dev -w apps/web
npm run dev -w apps/api
```

Apply Supabase migrations in order:

```text
supabase/migrations/0001_phase2_auth.sql
supabase/migrations/0002_phase3_database_phase4_menu.sql
```

Set `.env` values from `.env.example`.

## Important

The database migration must be applied to the target Supabase project before menu APIs can work. The generated archive does not contain `node_modules` or secrets.

## Phase 7–8: Inventory and purchasing hardening

Apply every migration in order in the Supabase SQL editor or through the Supabase CLI:

1. `supabase/migrations/0001_phase2_auth.sql`
2. `supabase/migrations/0002_phase3_database_phase4_menu.sql`
3. `supabase/migrations/0003_phase7_phase8_inventory_purchase_hardening.sql`

Migration 0003 adds atomic stock adjustment, purchase creation, purchase receiving and recipe-based order stock consumption RPCs. It also adds purchase status and idempotency fields. **Do not test purchase receiving or stock deduction until this migration has been applied to the Supabase project connected to the app.** Back up production data before applying schema changes.

## Netlify test deployment

This repository is a workspace monorepo. Netlify builds the Next.js app from `apps/web`; the Express API in `apps/api` is a separate service and is not hosted by the Next.js build automatically.

Configure these environment variables in **Netlify → Project configuration → Environment variables** for the production and deploy-preview contexts as applicable:

- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Supabase publishable/anon key (never a service-role key)
- `NEXT_PUBLIC_API_URL`: public HTTPS base URL for the separately deployed Express API, with no trailing slash

Configure the Express service with `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `CORS_ORIGIN` (the exact Netlify site origin), and `PORT`. Keep all secret values in provider environment settings, never in Git. The API must be reachable over HTTPS from the Netlify site.

## Verification before calling a phase complete

From the repository root, run:

```bash
npm install
npm run typecheck
npm run lint
npm run build
```

Then run authenticated end-to-end checks against a non-production Supabase branch: create an inventory item, adjust stock, create a recipe, create a purchase, receive it twice (the second request must not add stock again), and consume an order twice (the second request must not deduct stock again). Verify branch isolation and inspect the stock movement ledger. A successful Netlify build alone does not verify the Express API or database migration.
