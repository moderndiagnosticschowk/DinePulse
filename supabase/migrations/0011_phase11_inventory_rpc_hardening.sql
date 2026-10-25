-- Phase 11: harden inventory RPCs against direct PostgREST invocation.
-- Forward-only migration: preserve live RPC names, argument signatures and return types.
-- Apply to a non-production database first; do not rerun historical migrations.

create or replace function public.adjust_inventory_stock(
  p_branch_id uuid,
  p_inventory_item_id uuid,
  p_quantity numeric,
  p_movement_type text,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_notes text default null,
  p_created_by uuid default null
) returns public.stock_movements
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item public.inventory_items%rowtype;
  v_movement public.stock_movements%rowtype;
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.user_has_branch_role(
    p_branch_id,
    array['OWNER','ADMIN','MANAGER','INVENTORY_MANAGER']::public.membership_role[]
  ) then
    raise exception 'Inventory manager permission required' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity = 0 then
    raise exception 'Quantity must be non-zero';
  end if;
  if p_movement_type is null or p_movement_type not in ('PURCHASE','SALE','WASTE','ADJUSTMENT_IN','ADJUSTMENT_OUT','RETURN') then
    raise exception 'Invalid movement type';
  end if;

  select * into v_item
  from public.inventory_items
  where id = p_inventory_item_id and branch_id = p_branch_id and is_active = true
  for update;
  if not found then
    raise exception 'Inventory item not found in this branch';
  end if;
  if v_item.current_stock + p_quantity < 0 then
    raise exception 'Insufficient stock';
  end if;

  update public.inventory_items
  set current_stock = current_stock + p_quantity, updated_at = now()
  where id = v_item.id;

  insert into public.stock_movements(
    branch_id, inventory_item_id, movement_type, quantity,
    reference_type, reference_id, notes, created_by
  )
  values (
    p_branch_id, v_item.id, p_movement_type::public.stock_movement_type, p_quantity,
    p_reference_type, p_reference_id, left(p_notes, 500), v_actor
  )
  returning * into v_movement;

  return v_movement;
end;
$$;

-- This function did not exist in the inspected live schema. Create it with the
-- exact contract already used by apps/api/src/routes/inventory.ts.
create or replace function public.create_purchase(
  p_branch_id uuid,
  p_user_id uuid,
  p_supplier_id uuid,
  p_invoice_number text,
  p_purchase_date date,
  p_tax_amount numeric,
  p_payment_status text,
  p_paid_amount numeric,
  p_notes text,
  p_items jsonb,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_purchase public.purchases%rowtype;
  v_line jsonb;
  v_item_id uuid;
  v_qty numeric(14,3);
  v_cost numeric(12,4);
  v_line_tax numeric(12,2);
  v_subtotal numeric(12,2) := 0;
  v_tax numeric(12,2) := coalesce(p_tax_amount, 0);
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.user_has_branch_role(
    p_branch_id,
    array['OWNER','ADMIN','MANAGER','INVENTORY_MANAGER']::public.membership_role[]
  ) then
    raise exception 'Purchase permission required' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one purchase item is required';
  end if;
  if coalesce(p_tax_amount, 0) < 0 or coalesce(p_paid_amount, 0) < 0 then
    raise exception 'Tax and paid amount cannot be negative';
  end if;
  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers where id = p_supplier_id and branch_id = p_branch_id
  ) then
    raise exception 'Supplier not found in this branch';
  end if;

  if p_idempotency_key is not null then
    select * into v_purchase
    from public.purchases
    where branch_id = p_branch_id and idempotency_key = p_idempotency_key
    for update;
    if found then
      return jsonb_build_object('purchase', to_jsonb(v_purchase), 'duplicate', true);
    end if;
  end if;

  for v_line in select value from jsonb_array_elements(p_items) loop
    v_item_id := (v_line->>'inventory_item_id')::uuid;
    v_qty := (v_line->>'quantity')::numeric;
    v_cost := (v_line->>'unit_cost')::numeric;
    v_line_tax := coalesce((v_line->>'tax_amount')::numeric, 0);
    if v_qty is null or v_qty <= 0 or v_cost is null or v_cost < 0 or v_line_tax < 0 then
      raise exception 'Invalid purchase line quantity, cost or tax';
    end if;
    if not exists (
      select 1 from public.inventory_items
      where id = v_item_id and branch_id = p_branch_id and is_active = true
    ) then
      raise exception 'Inventory item not found in this branch';
    end if;
    v_subtotal := v_subtotal + round(v_qty * v_cost, 2);
    v_tax := v_tax + v_line_tax;
  end loop;

  begin
    insert into public.purchases(
      branch_id, supplier_id, invoice_number, purchase_date, subtotal, tax_amount,
      total_amount, payment_status, paid_amount, notes, created_by, idempotency_key, status
    )
    values (
      p_branch_id, p_supplier_id, nullif(trim(p_invoice_number), ''),
      coalesce(p_purchase_date, current_date), v_subtotal, v_tax, v_subtotal + v_tax,
      coalesce(p_payment_status, 'PENDING'), coalesce(p_paid_amount, 0), p_notes,
      auth.uid(), p_idempotency_key, 'DRAFT'
    )
    returning * into v_purchase;
  exception when unique_violation then
    -- Concurrent retries can pass the initial lookup before either transaction commits.
    -- Return the winning purchase only when the idempotency key identifies it.
    if p_idempotency_key is not null then
      select * into v_purchase
      from public.purchases
      where branch_id = p_branch_id and idempotency_key = p_idempotency_key;
      if found then
        return jsonb_build_object('purchase', to_jsonb(v_purchase), 'duplicate', true);
      end if;
    end if;
    raise;
  end;

  for v_line in select value from jsonb_array_elements(p_items) loop
    insert into public.purchase_items(
      purchase_id, inventory_item_id, quantity, unit_cost, tax_amount, total_amount
    )
    values (
      v_purchase.id,
      (v_line->>'inventory_item_id')::uuid,
      (v_line->>'quantity')::numeric,
      (v_line->>'unit_cost')::numeric,
      coalesce((v_line->>'tax_amount')::numeric, 0),
      round((v_line->>'quantity')::numeric * (v_line->>'unit_cost')::numeric, 2)
        + coalesce((v_line->>'tax_amount')::numeric, 0)
    );
  end loop;

  return jsonb_build_object('purchase', to_jsonb(v_purchase), 'duplicate', false);
end;
$$;

create or replace function public.receive_purchase(
  p_purchase_id uuid,
  p_branch_id uuid,
  p_user_id uuid
) returns public.purchases
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_purchase public.purchases%rowtype;
  v_item record;
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.user_has_branch_role(
    p_branch_id,
    array['OWNER','ADMIN','MANAGER','INVENTORY_MANAGER']::public.membership_role[]
  ) then
    raise exception 'Purchase permission required' using errcode = '42501';
  end if;

  select * into v_purchase
  from public.purchases
  where id = p_purchase_id and branch_id = p_branch_id
  for update;
  if not found then raise exception 'Purchase not found in this branch'; end if;
  if v_purchase.status = 'RECEIVED' then return v_purchase; end if;
  if v_purchase.status = 'CANCELLED' then raise exception 'Cancelled purchase cannot be received'; end if;

  for v_item in
    select pi.* from public.purchase_items pi where pi.purchase_id = v_purchase.id
  loop
    perform public.adjust_inventory_stock(
      p_branch_id, v_item.inventory_item_id, v_item.quantity, 'PURCHASE',
      'PURCHASE', v_purchase.id, 'Purchase received', v_actor
    );
    update public.inventory_items
    set cost_per_unit = v_item.unit_cost, updated_at = now()
    where id = v_item.inventory_item_id and branch_id = p_branch_id;
  end loop;

  update public.purchases
  set status = 'RECEIVED', received_at = now(),
      received_by = v_actor, updated_at = now()
  where id = v_purchase.id
  returning * into v_purchase;
  return v_purchase;
end;
$$;

-- Durable marker for all consumed orders, including orders with no configured recipe.
-- Direct table access is intentionally denied; the SECURITY DEFINER RPC owns writes.
create table if not exists public.order_stock_consumptions (
  order_id uuid primary key references public.orders(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  consumed_by uuid not null,
  movement_count integer not null default 0 check (movement_count >= 0),
  consumed_at timestamptz not null default now()
);

create index if not exists idx_order_stock_consumptions_branch_time
  on public.order_stock_consumptions(branch_id, consumed_at desc);

alter table public.order_stock_consumptions enable row level security;
revoke all on table public.order_stock_consumptions from public, anon, authenticated;

create or replace function public.consume_order_stock(
  p_order_id uuid,
  p_branch_id uuid,
  p_user_id uuid
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.orders%rowtype;
  v_order_item record;
  v_ingredient record;
  v_needed numeric(14,3);
  v_count integer := 0;
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.user_has_branch_role(
    p_branch_id,
    array['OWNER','ADMIN','MANAGER','INVENTORY_MANAGER']::public.membership_role[]
  ) then
    raise exception 'Order stock permission required' using errcode = '42501';
  end if;

  -- Serialize retries for the same order before checking the durable ledger.
  select * into v_order
  from public.orders
  where id = p_order_id and branch_id = p_branch_id
  for update;
  if not found then raise exception 'Order not found in this branch'; end if;

  if exists (
    select 1 from public.order_stock_consumptions
    where order_id = p_order_id and branch_id = p_branch_id
  ) then
    return 0;
  end if;

  -- Backfill a marker for orders consumed by the legacy movement-only implementation.
  if exists (
    select 1 from public.stock_movements
    where branch_id = p_branch_id
      and reference_type in ('ORDER', 'ORDER_CONSUMPTION')
      and reference_id = p_order_id
  ) then
    insert into public.order_stock_consumptions(order_id, branch_id, consumed_by, movement_count)
    values (p_order_id, p_branch_id, v_actor, 0)
    on conflict (order_id) do nothing;
    return 0;
  end if;

  for v_order_item in
    select oi.menu_item_id, oi.quantity
    from public.order_items oi
    where oi.order_id = p_order_id
  loop
    for v_ingredient in
      select ri.inventory_item_id, ri.quantity, r.yield_quantity
      from public.recipes r
      join public.recipe_ingredients ri on ri.recipe_id = r.id
      where r.branch_id = p_branch_id
        and r.menu_item_id = v_order_item.menu_item_id
    loop
      if v_ingredient.yield_quantity is null or v_ingredient.yield_quantity <= 0
        or v_ingredient.quantity is null or v_ingredient.quantity <= 0
        or v_order_item.quantity is null or v_order_item.quantity <= 0 then
        raise exception 'Recipe quantities and yield must be positive';
      end if;

      v_needed := (v_ingredient.quantity / v_ingredient.yield_quantity) * v_order_item.quantity;
      perform public.adjust_inventory_stock(
        p_branch_id, v_ingredient.inventory_item_id, -v_needed, 'SALE',
        'ORDER', p_order_id, 'Recipe consumption', v_actor
      );
      v_count := v_count + 1;
    end loop;
  end loop;

  -- Insert even when no recipes/ingredients exist so retry is still idempotent.
  insert into public.order_stock_consumptions(order_id, branch_id, consumed_by, movement_count)
  values (p_order_id, p_branch_id, v_actor, v_count)
  on conflict (order_id) do nothing;

  return v_count;
end;
$$;

-- Remove direct anonymous/public execution. Authenticated calls still pass
-- through explicit per-function branch-role checks and table RLS.
revoke all on function public.adjust_inventory_stock(uuid,uuid,numeric,text,text,uuid,text,uuid) from public, anon;
revoke all on function public.create_purchase(uuid,uuid,uuid,text,date,numeric,text,numeric,text,jsonb,text) from public, anon;
revoke all on function public.receive_purchase(uuid,uuid,uuid) from public, anon;
revoke all on function public.consume_order_stock(uuid,uuid,uuid) from public, anon;

grant execute on function public.adjust_inventory_stock(uuid,uuid,numeric,text,text,uuid,text,uuid) to authenticated;
grant execute on function public.create_purchase(uuid,uuid,uuid,text,date,numeric,text,numeric,text,jsonb,text) to authenticated;
grant execute on function public.receive_purchase(uuid,uuid,uuid) to authenticated;
grant execute on function public.consume_order_stock(uuid,uuid,uuid) to authenticated;
