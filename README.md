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
