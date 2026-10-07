-- Smart Restaurant POS: Phase 3 core database + RLS, Phase 4 menu management
create extension if not exists pgcrypto;

-- ---------- enums ----------
do $$ begin
  create type public.order_type as enum ('DINE_IN','TAKEAWAY','DELIVERY','QUICK_BILL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_status as enum ('OPEN','SENT_TO_KITCHEN','PREPARING','READY','SERVED','PAID','CANCELLED','REFUNDED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.kitchen_item_status as enum ('NEW','PREPARING','READY','SERVED','CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.table_status as enum ('AVAILABLE','OCCUPIED','RESERVED','BILLING','CLEANING');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_method as enum ('CASH','UPI','CARD','ONLINE','OTHER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_status as enum ('PENDING','COMPLETED','FAILED','REFUNDED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.stock_movement_type as enum ('PURCHASE','SALE','WASTE','ADJUSTMENT_IN','ADJUSTMENT_OUT','RETURN');
exception when duplicate_object then null; end $$;

-- ---------- shared timestamp trigger ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- restaurant tables ----------
create table if not exists public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  table_number text not null,
  capacity integer not null default 4 check (capacity > 0),
  section_name text,
  status public.table_status not null default 'AVAILABLE',
  shape text not null default 'RECTANGLE',
  position_x integer not null default 0,
  position_y integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(branch_id, table_number)
);

-- ---------- menu ----------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  description text,
  image_url text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(branch_id, name)
);

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  description text,
  sku text,
  price numeric(12,2) not null check (price >= 0),
  cost_price numeric(12,2) check (cost_price is null or cost_price >= 0),
  tax_rate numeric(5,2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  image_url text,
  is_veg boolean not null default false,
  is_available boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_menu_items_branch_sku on public.menu_items(branch_id, sku) where sku is not null;
create index if not exists idx_menu_items_branch_category on public.menu_items(branch_id, category_id);
create index if not exists idx_menu_items_branch_active on public.menu_items(branch_id, is_active, is_available);

create table if not exists public.modifiers (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  price numeric(12,2) not null default 0 check (price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(branch_id, name)
);

create table if not exists public.menu_item_modifiers (
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  modifier_id uuid not null references public.modifiers(id) on delete cascade,
  primary key(menu_item_id, modifier_id)
);

-- ---------- customers ----------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text,
  phone text,
  email text,
  address text,
  notes text,
  loyalty_points integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_customers_branch_phone on public.customers(branch_id, phone);

-- ---------- orders / payments ----------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  order_number bigint,
  order_type public.order_type not null,
  table_id uuid references public.restaurant_tables(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  status public.order_status not null default 'OPEN',
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  tax_amount numeric(12,2) not null default 0 check (tax_amount >= 0),
  service_charge numeric(12,2) not null default 0 check (service_charge >= 0),
  round_off numeric(12,2) not null default 0,
  grand_total numeric(12,2) not null default 0 check (grand_total >= 0),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_orders_branch_created on public.orders(branch_id, created_at desc);
create index if not exists idx_orders_branch_status on public.orders(branch_id, status);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  item_name text not null,
  quantity numeric(10,2) not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  tax_amount numeric(12,2) not null default 0 check (tax_amount >= 0),
  line_total numeric(12,2) not null default 0 check (line_total >= 0),
  kitchen_status public.kitchen_item_status not null default 'NEW',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_order_items_order_id on public.order_items(order_id);

create table if not exists public.order_item_modifiers (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  modifier_id uuid references public.modifiers(id) on delete set null,
  modifier_name text not null,
  price numeric(12,2) not null default 0 check (price >= 0),
  quantity numeric(10,2) not null default 1 check (quantity > 0)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  payment_method public.payment_method not null,
  amount numeric(12,2) not null check (amount > 0),
  reference_number text,
  status public.payment_status not null default 'COMPLETED',
  paid_at timestamptz,
  received_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_payments_order_id on public.payments(order_id);

-- ---------- recipes / inventory ----------
create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  sku text,
  unit text not null,
  current_stock numeric(14,3) not null default 0,
  minimum_stock numeric(14,3) not null default 0,
  cost_per_unit numeric(12,4) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(branch_id, name)
);
create index if not exists idx_inventory_branch_active on public.inventory_items(branch_id, is_active);

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  name text,
  yield_quantity numeric(10,2) not null default 1 check (yield_quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(branch_id, menu_item_id)
);

create table if not exists public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  unique(recipe_id, inventory_item_id)
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  movement_type public.stock_movement_type not null,
  quantity numeric(14,3) not null check (quantity > 0),
  reference_type text,
  reference_id uuid,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_stock_movements_branch_created on public.stock_movements(branch_id, created_at desc);

-- ---------- purchase / supplier / expenses ----------
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  address text,
  gstin text,
  opening_balance numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  invoice_number text,
  purchase_date date not null default current_date,
  subtotal numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  payment_status text not null default 'PENDING',
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(12,4) not null check (unit_cost >= 0),
  tax_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  category text not null,
  description text,
  amount numeric(12,2) not null check (amount >= 0),
  expense_date date not null default current_date,
  payment_method public.payment_method,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.printers (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  printer_type text not null,
  connection_type text not null,
  ip_address text,
  port integer,
  printer_role text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.settings (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(branch_id, key)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_logs_branch_created on public.audit_logs(branch_id, created_at desc);

-- ---------- updated-at triggers ----------
do $$
declare t text;
begin
  foreach t in array array['restaurant_tables','categories','menu_items','modifiers','customers','orders','order_items','payments','inventory_items','recipes','suppliers','purchases','expenses','printers','settings'] loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', t, t);
    execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ---------- helper functions ----------
create or replace function public.user_has_branch_role(p_branch_id uuid, p_roles public.membership_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.branch_memberships bm
    where bm.branch_id = p_branch_id
      and bm.user_id = auth.uid()
      and bm.is_active = true
      and bm.role = any(p_roles)
  );
$$;

create or replace function public.user_has_company_access(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.branches b
    join public.branch_memberships bm on bm.branch_id = b.id
    where b.company_id = p_company_id
      and bm.user_id = auth.uid()
      and bm.is_active = true
  );
$$;

-- ---------- RLS helper ----------
DO $$
declare t text;
begin
  foreach t in array array[
    'restaurant_tables','categories','menu_items','modifiers','menu_item_modifiers','customers','orders','order_items','order_item_modifiers','payments',
    'inventory_items','recipes','recipe_ingredients','stock_movements','suppliers','purchases','purchase_items','expenses','printers','settings','audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- tables: most operations require a permitted branch role
create policy restaurant_tables_select on public.restaurant_tables for select to authenticated using (public.user_has_branch_access(branch_id));
create policy restaurant_tables_insert on public.restaurant_tables for insert to authenticated with check (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER']::public.membership_role[]));
create policy restaurant_tables_update on public.restaurant_tables for update to authenticated using (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER','WAITER']::public.membership_role[])) with check (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER','WAITER']::public.membership_role[]));
create policy restaurant_tables_delete on public.restaurant_tables for delete to authenticated using (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER']::public.membership_role[]));

-- categories
create policy categories_select on public.categories for select to authenticated using (public.user_has_branch_access(branch_id));
create policy categories_insert on public.categories for insert to authenticated with check (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER']::public.membership_role[]));
create policy categories_update on public.categories for update to authenticated using (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER']::public.membership_role[])) with check (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER']::public.membership_role[]));
create policy categories_delete on public.categories for delete to authenticated using (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER']::public.membership_role[]));

-- menu items
create policy menu_items_select on public.menu_items for select to authenticated using (public.user_has_branch_access(branch_id));
create policy menu_items_insert on public.menu_items for insert to authenticated with check (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER']::public.membership_role[]));
create policy menu_items_update on public.menu_items for update to authenticated using (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER']::public.membership_role[])) with check (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER']::public.membership_role[]));
create policy menu_items_delete on public.menu_items for delete to authenticated using (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER']::public.membership_role[]));

-- modifiers
create policy modifiers_select on public.modifiers for select to authenticated using (public.user_has_branch_access(branch_id));
create policy modifiers_insert on public.modifiers for insert to authenticated with check (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER']::public.membership_role[]));
create policy modifiers_update on public.modifiers for update to authenticated using (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER']::public.membership_role[])) with check (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER']::public.membership_role[]));
create policy modifiers_delete on public.modifiers for delete to authenticated using (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER']::public.membership_role[]));

create policy menu_item_modifiers_select on public.menu_item_modifiers for select to authenticated using (
  exists(select 1 from public.menu_items mi where mi.id = menu_item_id and public.user_has_branch_access(mi.branch_id))
);
create policy menu_item_modifiers_insert on public.menu_item_modifiers for insert to authenticated with check (
  exists(select 1 from public.menu_items mi join public.modifiers m on m.branch_id=mi.branch_id where mi.id=menu_item_id and m.id=modifier_id and public.user_has_branch_role(mi.branch_id, array['OWNER','ADMIN','MANAGER']::public.membership_role[]))
);
create policy menu_item_modifiers_delete on public.menu_item_modifiers for delete to authenticated using (
  exists(select 1 from public.menu_items mi where mi.id=menu_item_id and public.user_has_branch_role(mi.branch_id, array['OWNER','ADMIN','MANAGER']::public.membership_role[]))
);

-- generic branch-scoped RLS for operational tables
create policy customers_select on public.customers for select to authenticated using (public.user_has_branch_access(branch_id));
create policy customers_write on public.customers for all to authenticated using (public.user_has_branch_access(branch_id)) with check (public.user_has_branch_access(branch_id));

create policy orders_select on public.orders for select to authenticated using (public.user_has_branch_access(branch_id));
create policy orders_write on public.orders for all to authenticated using (public.user_has_branch_access(branch_id)) with check (public.user_has_branch_access(branch_id));

create policy order_items_select on public.order_items for select to authenticated using (exists(select 1 from public.orders o where o.id=order_id and public.user_has_branch_access(o.branch_id)));
create policy order_items_write on public.order_items for all to authenticated using (exists(select 1 from public.orders o where o.id=order_id and public.user_has_branch_role(o.branch_id, array['OWNER','ADMIN','MANAGER','CASHIER','WAITER']::public.membership_role[]))) with check (exists(select 1 from public.orders o where o.id=order_id and public.user_has_branch_role(o.branch_id, array['OWNER','ADMIN','MANAGER','CASHIER','WAITER']::public.membership_role[])));

create policy order_item_modifiers_select on public.order_item_modifiers for select to authenticated using (exists(select 1 from public.order_items oi join public.orders o on o.id=oi.order_id where oi.id=order_item_id and public.user_has_branch_access(o.branch_id)));
create policy order_item_modifiers_write on public.order_item_modifiers for all to authenticated using (exists(select 1 from public.order_items oi join public.orders o on o.id=oi.order_id where oi.id=order_item_id and public.user_has_branch_role(o.branch_id, array['OWNER','ADMIN','MANAGER','CASHIER','WAITER']::public.membership_role[]))) with check (exists(select 1 from public.order_items oi join public.orders o on o.id=oi.order_id where oi.id=order_item_id and public.user_has_branch_role(o.branch_id, array['OWNER','ADMIN','MANAGER','CASHIER','WAITER']::public.membership_role[])));

create policy payments_select on public.payments for select to authenticated using (exists(select 1 from public.orders o where o.id=order_id and public.user_has_branch_access(o.branch_id)));
create policy payments_write on public.payments for all to authenticated using (exists(select 1 from public.orders o where o.id=order_id and public.user_has_branch_role(o.branch_id, array['OWNER','ADMIN','MANAGER','CASHIER']::public.membership_role[]))) with check (exists(select 1 from public.orders o where o.id=order_id and public.user_has_branch_role(o.branch_id, array['OWNER','ADMIN','MANAGER','CASHIER']::public.membership_role[])));

create policy inventory_items_select on public.inventory_items for select to authenticated using (public.user_has_branch_access(branch_id));
create policy inventory_items_write on public.inventory_items for all to authenticated using (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER','INVENTORY_MANAGER']::public.membership_role[])) with check (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER','INVENTORY_MANAGER']::public.membership_role[]));

create policy recipes_select on public.recipes for select to authenticated using (public.user_has_branch_access(branch_id));
create policy recipes_write on public.recipes for all to authenticated using (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER','INVENTORY_MANAGER']::public.membership_role[])) with check (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER','INVENTORY_MANAGER']::public.membership_role[]));
create policy recipe_ingredients_select on public.recipe_ingredients for select to authenticated using (exists(select 1 from public.recipes r where r.id=recipe_id and public.user_has_branch_access(r.branch_id)));
create policy recipe_ingredients_write on public.recipe_ingredients for all to authenticated using (exists(select 1 from public.recipes r where r.id=recipe_id and public.user_has_branch_role(r.branch_id, array['OWNER','ADMIN','MANAGER','INVENTORY_MANAGER']::public.membership_role[]))) with check (exists(select 1 from public.recipes r where r.id=recipe_id and public.user_has_branch_role(r.branch_id, array['OWNER','ADMIN','MANAGER','INVENTORY_MANAGER']::public.membership_role[])));

create policy stock_movements_select on public.stock_movements for select to authenticated using (public.user_has_branch_access(branch_id));
create policy stock_movements_insert on public.stock_movements for insert to authenticated with check (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER','INVENTORY_MANAGER']::public.membership_role[]));

create policy suppliers_select on public.suppliers for select to authenticated using (public.user_has_branch_access(branch_id));
create policy suppliers_write on public.suppliers for all to authenticated using (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER','INVENTORY_MANAGER']::public.membership_role[])) with check (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER','INVENTORY_MANAGER']::public.membership_role[]));

create policy purchases_select on public.purchases for select to authenticated using (public.user_has_branch_access(branch_id));
create policy purchases_write on public.purchases for all to authenticated using (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER','INVENTORY_MANAGER']::public.membership_role[])) with check (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER','INVENTORY_MANAGER']::public.membership_role[]));
create policy purchase_items_select on public.purchase_items for select to authenticated using (exists(select 1 from public.purchases p where p.id=purchase_id and public.user_has_branch_access(p.branch_id)));
create policy purchase_items_write on public.purchase_items for all to authenticated using (exists(select 1 from public.purchases p where p.id=purchase_id and public.user_has_branch_role(p.branch_id, array['OWNER','ADMIN','MANAGER','INVENTORY_MANAGER']::public.membership_role[]))) with check (exists(select 1 from public.purchases p where p.id=purchase_id and public.user_has_branch_role(p.branch_id, array['OWNER','ADMIN','MANAGER','INVENTORY_MANAGER']::public.membership_role[])));

create policy expenses_select on public.expenses for select to authenticated using (public.user_has_branch_access(branch_id));
create policy expenses_write on public.expenses for all to authenticated using (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER']::public.membership_role[])) with check (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER']::public.membership_role[]));

create policy printers_select on public.printers for select to authenticated using (public.user_has_branch_access(branch_id));
create policy printers_write on public.printers for all to authenticated using (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER']::public.membership_role[])) with check (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER']::public.membership_role[]));

create policy settings_select on public.settings for select to authenticated using (public.user_has_branch_access(branch_id));
create policy settings_write on public.settings for all to authenticated using (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER']::public.membership_role[])) with check (public.user_has_branch_role(branch_id, array['OWNER','ADMIN','MANAGER']::public.membership_role[]));

-- audit logs: users may read their accessible branch; inserts reserved for server/service functions in later phases.
create policy audit_logs_select on public.audit_logs for select to authenticated using (
  branch_id is null or public.user_has_branch_access(branch_id)
);

-- ---------- seed defaults per newly-created branch via a helper ----------
create or replace function public.seed_branch_menu(p_branch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.categories(branch_id,name,sort_order)
  values
    (p_branch_id,'Starters',10),
    (p_branch_id,'Main Course',20),
    (p_branch_id,'Breads',30),
    (p_branch_id,'Rice',40),
    (p_branch_id,'Beverages',50),
    (p_branch_id,'Desserts',60)
  on conflict (branch_id,name) do nothing;
end;
$$;
revoke all on function public.seed_branch_menu(uuid) from public;
revoke all on function public.seed_branch_menu(uuid) from authenticated;

-- Cross-branch integrity for menu relationships
create or replace function public.validate_menu_branch_relationships()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.categories c where c.id = new.category_id and c.branch_id = new.branch_id
  ) then
    raise exception 'Category belongs to a different branch';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_menu_branch on public.menu_items;
create trigger trg_validate_menu_branch
before insert or update of branch_id, category_id on public.menu_items
for each row execute function public.validate_menu_branch_relationships();

create or replace function public.validate_modifier_branch_relationships()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.menu_items mi
    join public.modifiers m on m.branch_id = mi.branch_id
    where mi.id = new.menu_item_id and m.id = new.modifier_id
  ) then
    raise exception 'Menu item and modifier must belong to the same branch';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_modifier_branch on public.menu_item_modifiers;
create trigger trg_validate_modifier_branch
before insert or update on public.menu_item_modifiers
for each row execute function public.validate_modifier_branch_relationships();

-- Grant table privileges to authenticated users; RLS remains the row-level gate.
grant select, insert, update, delete on public.restaurant_tables, public.categories, public.menu_items, public.modifiers, public.menu_item_modifiers, public.customers, public.orders, public.order_items, public.order_item_modifiers, public.payments, public.inventory_items, public.recipes, public.recipe_ingredients, public.stock_movements, public.suppliers, public.purchases, public.purchase_items, public.expenses, public.printers, public.settings, public.audit_logs to authenticated;

-- Seed default categories for branches that already existed before this migration.
insert into public.categories(branch_id,name,sort_order)
select b.id, v.name, v.sort_order
from public.branches b
cross join (values ('Starters',10),('Main Course',20),('Breads',30),('Rice',40),('Beverages',50),('Desserts',60)) as v(name,sort_order)
on conflict (branch_id,name) do nothing;

-- Extend onboarding to seed the initial menu category set for each newly-created branch.
create or replace function public.complete_workspace_onboarding(p_company_name text, p_branch_name text, p_full_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_company uuid;
  v_branch uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if coalesce(trim(p_company_name),'') = '' then raise exception 'Company name is required'; end if;
  if coalesce(trim(p_branch_name),'') = '' then raise exception 'Branch name is required'; end if;

  insert into public.profiles(id, full_name)
  values(v_user, nullif(trim(p_full_name),''))
  on conflict(id) do update set full_name = excluded.full_name, updated_at = now();

  select c.id into v_company
  from public.companies c
  join public.branches b on b.company_id = c.id
  join public.branch_memberships bm on bm.branch_id = b.id
  where bm.user_id = v_user and bm.role = 'OWNER'
  limit 1;

  if v_company is not null then
    select b.id into v_branch
    from public.branches b
    join public.branch_memberships bm on bm.branch_id = b.id
    where b.company_id = v_company and bm.user_id=v_user and bm.role='OWNER'
    order by b.created_at asc
    limit 1;
    perform public.seed_branch_menu(v_branch);
    return jsonb_build_object('company_id',v_company,'branch_id',v_branch,'created',false);
  end if;

  insert into public.companies(name) values(trim(p_company_name)) returning id into v_company;
  insert into public.branches(company_id,name,code) values(v_company,trim(p_branch_name),'MAIN') returning id into v_branch;
  insert into public.branch_memberships(branch_id,user_id,role) values(v_branch,v_user,'OWNER');
  perform public.seed_branch_menu(v_branch);

  return jsonb_build_object('company_id',v_company,'branch_id',v_branch,'created',true);
end;
$$;
revoke all on function public.complete_workspace_onboarding(text,text,text) from public;
grant execute on function public.complete_workspace_onboarding(text,text,text) to authenticated;
