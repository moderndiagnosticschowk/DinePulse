-- DinePulse Phase 7 + 8 supplemental inventory/purchase columns and indexes.
-- RPC implementations live in 0003_phase7_phase8_inventory_purchase_hardening.sql.
-- Keep this migration additive: older versions redefined receive_purchase and
-- consume_order_stock with incompatible return types, causing PostgreSQL 42P13.

alter table public.purchases
  add column if not exists status text not null default 'DRAFT',
  add column if not exists paid_amount numeric(12,2) not null default 0,
  add column if not exists received_at timestamptz,
  add column if not exists received_by uuid references public.profiles(id),
  add column if not exists idempotency_key text;

create unique index if not exists uq_purchases_branch_invoice
  on public.purchases(branch_id, invoice_number)
  where invoice_number is not null;

create unique index if not exists uq_purchases_branch_idempotency
  on public.purchases(branch_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_inventory_branch_stock
  on public.inventory_items(branch_id, current_stock, minimum_stock);

create index if not exists idx_stock_movements_branch_item_created
  on public.stock_movements(branch_id, inventory_item_id, created_at desc);

create index if not exists idx_recipes_branch_menu
  on public.recipes(branch_id, menu_item_id);

create index if not exists idx_purchases_branch_date
  on public.purchases(branch_id, purchase_date desc);
