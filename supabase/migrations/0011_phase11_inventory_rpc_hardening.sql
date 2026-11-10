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
set search_path = pg_catalog, public
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
  -- Keep signed quantities consistent with movement labels even for direct RPC calls.
  -- RETURN remains direction-flexible because it may represent either customer or supplier returns.
  if (p_movement_type in ('PURCHASE','ADJUSTMENT_IN') and p_quantity < 0)
    or (p_movement_type in ('SALE','WASTE','ADJUSTMENT_OUT') and p_quantity > 0) then
    raise exception 'Quantity sign does not match movement type';
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

  -- stock_movements.quantity is constrained to a positive magnitude; direction is
  -- represented by movement_type while the signed input controls the stock delta.
  insert into public.stock_movements(
    branch_id, inventory_item_id, movement_type, quantity,
    reference_type, reference_id, notes, created_by
  )
  values (
    p_branch_id, v_item.id, p_movement_type::public.stock_movement_type, abs(p_quantity),
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
set search_path = pg_catalog, public
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
set search_path = pg_catalog, public
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
    array['OWNER','ADMIN','MANAGER','CASHIER','INVENTORY_MANAGER']::public.membership_role[]
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

  -- Never create a legacy-consumption marker for an unpaid order. Otherwise an
  -- early direct RPC call could make the later paid-order settlement skip stock.
  if v_order.status <> 'PAID' then
    raise exception 'Only paid orders can consume stock' using errcode = '55000';
  end if;

  -- Backfill a marker only after confirming the order is paid. The legacy flow
  -- consumed all recipe movements in one transaction, so any matching legacy
  -- order movement is treated as already consumed.
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
      -- Perform the order-linked deduction here rather than calling the general
      -- adjustment RPC: CASHIER may consume stock for a paid order, but must not
      -- gain permission to make arbitrary inventory adjustments.
      update public.inventory_items
      set current_stock = current_stock - v_needed, updated_at = now()
      where id = v_ingredient.inventory_item_id
        and branch_id = p_branch_id
        and is_active = true
        and current_stock >= v_needed;
      if not found then
        raise exception 'Insufficient stock or inactive inventory item';
      end if;

      insert into public.stock_movements(
        branch_id, inventory_item_id, movement_type, quantity,
        reference_type, reference_id, notes, created_by
      )
      values (
        p_branch_id, v_ingredient.inventory_item_id, 'SALE', v_needed,
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


-- Persist payment retries and settle the order, payment and stock in one transaction.
alter table public.payments
  add column if not exists idempotency_key text;

create unique index if not exists uq_payments_order_idempotency
  on public.payments(order_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.settle_order_payment(
  p_order_id uuid,
  p_branch_id uuid,
  p_payment_method public.payment_method,
  p_idempotency_key text,
  p_amount numeric default null,
  p_reference_number text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_existing public.payments%rowtype;
  v_payment public.payments%rowtype;
  v_paid_before numeric(12,2) := 0;
  v_paid_after numeric(12,2) := 0;
  v_due numeric(12,2) := 0;
  v_amount numeric(12,2) := 0;
  v_stock_count integer := 0;
  v_is_paid boolean := false;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_payment_method is null then
    raise exception 'Payment method is required';
  end if;
  if p_idempotency_key is null
    or length(trim(p_idempotency_key)) < 8
    or length(p_idempotency_key) > 100 then
    raise exception 'A valid payment idempotency key is required';
  end if;
  if p_amount is not null and (
    p_amount <= 0
    or p_amount::text in ('NaN', 'Infinity', '-Infinity')
    or p_amount <> round(p_amount, 2)
  ) then
    raise exception 'Payment amount must be positive, finite, and have at most two decimal places';
  end if;
  if not public.user_has_branch_role(
    p_branch_id,
    array['OWNER','ADMIN','MANAGER','CASHIER']::public.membership_role[]
  ) then
    raise exception 'Billing permission required' using errcode = '42501';
  end if;

  -- Locking the order serializes all payment attempts for this order.
  select * into v_order
  from public.orders
  where id = p_order_id and branch_id = p_branch_id
  for update;
  if not found then
    raise exception 'Order not found in this branch';
  end if;

  -- A retry after a lost HTTP response returns the original payment.
  select * into v_existing
  from public.payments
  where order_id = p_order_id and idempotency_key = p_idempotency_key;
  if found then
    -- Reconstruct the outstanding balance immediately before this payment so
    -- a NULL p_amount retry is bound to the same full-balance request, not just
    -- to the same payment method. Explicit partial amounts must also match.
    select coalesce(sum(amount), 0)::numeric(12,2)
      into v_paid_before
    from public.payments
    where order_id = p_order_id
      and status = 'COMPLETED'
      and id <> v_existing.id;
    v_due := greatest(v_order.grand_total - v_paid_before, 0);

    if v_existing.status <> 'COMPLETED'
      or v_existing.payment_method <> p_payment_method
      or (p_amount is not null and v_existing.amount <> p_amount)
      or (p_amount is null and v_existing.amount <> v_due)
      or v_existing.reference_number is distinct from nullif(trim(p_reference_number), '') then
      raise exception 'Payment idempotency key was reused with different details'
        using errcode = '22023';
    end if;
    select coalesce(sum(amount), 0)::numeric(12,2)
      into v_paid_after
    from public.payments
    where order_id = p_order_id and status = 'COMPLETED';
    return jsonb_build_object(
      'payment', to_jsonb(v_existing),
      'duplicate', true,
      'paid', v_order.status = 'PAID',
      'remaining_amount', greatest(v_order.grand_total - v_paid_after, 0),
      'stock_movements', 0
    );
  end if;

  if v_order.status in ('CANCELLED','REFUNDED') then
    raise exception 'Cancelled or refunded orders cannot be settled';
  end if;
  if v_order.status = 'PAID' then
    -- Repair a legacy paid order whose old client-side billing flow missed stock.
    -- The consumption ledger and legacy movement guard make this retry-safe.
    v_stock_count := public.consume_order_stock(p_order_id, p_branch_id, v_actor);
    return jsonb_build_object(
      'payment', null,
      'duplicate', true,
      'paid', true,
      'remaining_amount', 0,
      'stock_movements', v_stock_count
    );
  end if;

  select coalesce(sum(amount), 0)::numeric(12,2)
    into v_paid_before
  from public.payments
  where order_id = p_order_id and status = 'COMPLETED';

  v_due := greatest(v_order.grand_total - v_paid_before, 0);
  if v_due > 0 then
    v_amount := coalesce(p_amount, v_due);
    if v_amount <= 0 or v_amount > v_due then
      raise exception 'Payment amount exceeds the outstanding balance';
    end if;

    insert into public.payments(
      order_id, payment_method, amount, reference_number,
      status, paid_at, received_by, idempotency_key
    )
    values (
      p_order_id, p_payment_method, v_amount, nullif(trim(p_reference_number), ''),
      'COMPLETED', now(), v_actor, p_idempotency_key
    )
    returning * into v_payment;
  elsif p_amount is not null and p_amount > 0 then
    raise exception 'No outstanding balance remains';
  end if;

  select coalesce(sum(amount), 0)::numeric(12,2)
    into v_paid_after
  from public.payments
  where order_id = p_order_id and status = 'COMPLETED';

  if v_paid_after >= v_order.grand_total then
    update public.orders
    set status = 'PAID',
        paid_at = coalesce(paid_at, now()),
        closed_by = v_actor,
        updated_at = now()
    where id = p_order_id and branch_id = p_branch_id;

    -- Any stock failure aborts this transaction, including the payment insert.
    v_stock_count := public.consume_order_stock(p_order_id, p_branch_id, v_actor);
    v_is_paid := true;
  end if;

  return jsonb_build_object(
    'payment', case when v_payment.id is null then null else to_jsonb(v_payment) end,
    'duplicate', false,
    'paid', v_is_paid,
    'remaining_amount', greatest(v_order.grand_total - v_paid_after, 0),
    'stock_movements', v_stock_count
  );
end;
$$;

revoke all on function public.settle_order_payment(uuid,uuid,public.payment_method,text,numeric,text) from public, anon;
grant execute on function public.settle_order_payment(uuid,uuid,public.payment_method,text,numeric,text) to authenticated;

-- Remove direct anonymous/public execution. Authenticated calls pass explicit
-- per-function branch-role checks; ledger table access is only through the guarded RPC.
revoke all on function public.adjust_inventory_stock(uuid,uuid,numeric,text,text,uuid,text,uuid) from public, anon;
revoke all on function public.create_purchase(uuid,uuid,uuid,text,date,numeric,text,numeric,text,jsonb,text) from public, anon;
revoke all on function public.receive_purchase(uuid,uuid,uuid) from public, anon;
revoke all on function public.consume_order_stock(uuid,uuid,uuid) from public, anon;

grant execute on function public.adjust_inventory_stock(uuid,uuid,numeric,text,text,uuid,text,uuid) to authenticated;
grant execute on function public.create_purchase(uuid,uuid,uuid,text,date,numeric,text,numeric,text,jsonb,text) to authenticated;
grant execute on function public.receive_purchase(uuid,uuid,uuid) to authenticated;
grant execute on function public.consume_order_stock(uuid,uuid,uuid) to authenticated;

-- Harden existing SECURITY DEFINER helpers used by onboarding and RLS.
-- Keep authenticated EXECUTE for policies/application flows, but remove the
-- unnecessary anonymous/public RPC surface. Pin all helper resolution to trusted
-- system objects first, then the explicitly-qualified public schema.
alter function public.set_updated_at()
  set search_path = pg_catalog, public;
alter function public.get_current_user_id()
  set search_path = pg_catalog, public;
alter function public.complete_workspace_onboarding(text, text, text)
  set search_path = pg_catalog, public;
alter function public.user_has_branch_access(uuid)
  set search_path = pg_catalog, public;
alter function public.user_has_branch_role(uuid, public.membership_role[])
  set search_path = pg_catalog, public;
alter function public.user_has_company_access(uuid)
  set search_path = pg_catalog, public;
alter function public.user_is_branch_owner_or_admin(uuid)
  set search_path = pg_catalog, public;

revoke execute on function public.complete_workspace_onboarding(text, text, text) from public, anon;
revoke execute on function public.user_has_branch_access(uuid) from public, anon;
revoke execute on function public.user_has_branch_role(uuid, public.membership_role[]) from public, anon;
revoke execute on function public.user_has_company_access(uuid) from public, anon;
revoke execute on function public.user_is_branch_owner_or_admin(uuid) from public, anon;

grant execute on function public.complete_workspace_onboarding(text, text, text) to authenticated;
grant execute on function public.user_has_branch_access(uuid) to authenticated;
grant execute on function public.user_has_branch_role(uuid, public.membership_role[]) to authenticated;
grant execute on function public.user_has_company_access(uuid) to authenticated;
grant execute on function public.user_is_branch_owner_or_admin(uuid) to authenticated;

-- This SECURITY DEFINER function is invoked only by the database-owned ensure_rls
-- event trigger. It is not an application RPC, so client roles need no EXECUTE.
-- PostgreSQL's event-trigger manager invokes the registered function internally.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- Allow kitchen staff to advance only the KOT status, without granting them
-- direct UPDATE access to the full order_items row.
create or replace function public.update_kitchen_item_status(
  p_order_item_id uuid,
  p_status public.kitchen_item_status
) returns public.order_items
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_item public.order_items%rowtype;
  v_branch_id uuid;
  v_allowed_roles public.membership_role[];
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('PREPARING', 'READY', 'SERVED') then
    raise exception 'Invalid kitchen status transition';
  end if;

  select * into v_item
  from public.order_items
  where id = p_order_item_id
  for update;
  if not found then
    raise exception 'Kitchen order item not found';
  end if;

  select branch_id into v_branch_id
  from public.orders
  where id = v_item.order_id;
  if v_branch_id is null then
    raise exception 'Parent order not found';
  end if;

  if p_status = 'SERVED' then
    v_allowed_roles := array['OWNER','ADMIN','MANAGER','KITCHEN','WAITER']::public.membership_role[];
  else
    v_allowed_roles := array['OWNER','ADMIN','MANAGER','KITCHEN']::public.membership_role[];
  end if;

  if not public.user_has_branch_role(v_branch_id, v_allowed_roles) then
    raise exception 'Kitchen status permission required' using errcode = '42501';
  end if;

  -- Same-target retries are idempotent after a lost response.
  if v_item.kitchen_status = p_status then
    return v_item;
  end if;

  if not (
    (v_item.kitchen_status = 'NEW' and p_status = 'PREPARING')
    or (v_item.kitchen_status = 'PREPARING' and p_status = 'READY')
    or (v_item.kitchen_status = 'READY' and p_status = 'SERVED')
  ) then
    raise exception 'Invalid kitchen status transition from % to %', v_item.kitchen_status, p_status
      using errcode = '22023';
  end if;

  update public.order_items
  set kitchen_status = p_status,
      updated_at = now()
  where id = v_item.id
  returning * into v_item;

  return v_item;
end;
$$;

revoke execute on function public.update_kitchen_item_status(uuid, public.kitchen_item_status) from public, anon;
grant execute on function public.update_kitchen_item_status(uuid, public.kitchen_item_status) to authenticated;

-- Route every order/order-item/payment write through a guarded RPC.
-- create_pos_order was originally SECURITY INVOKER and needed broad table DML
-- grants/RLS policies. Its body already validates auth.uid(), branch role,
-- table ownership, menu-item branch/availability, quantity and idempotency.
-- Run it as the function owner so browser roles do not need direct DML grants.
alter function public.create_pos_order(uuid,text,public.order_type,uuid,jsonb,text)
  security definer;
alter function public.create_pos_order(uuid,text,public.order_type,uuid,jsonb,text)
  set search_path = pg_catalog, public;
revoke all on function public.create_pos_order(uuid,text,public.order_type,uuid,jsonb,text)
  from public, anon;
grant execute on function public.create_pos_order(uuid,text,public.order_type,uuid,jsonb,text)
  to authenticated;

-- Remove every direct write policy from transaction tables. Reads remain
-- branch-scoped through the existing *_select policies. Writes are performed by
-- create_pos_order, settle_order_payment and update_kitchen_item_status only.
drop policy if exists orders_write on public.orders;
drop policy if exists orders_insert on public.orders;
drop policy if exists orders_update on public.orders;
drop policy if exists orders_delete on public.orders;
drop policy if exists order_items_write on public.order_items;
drop policy if exists payments_write on public.payments;

-- RLS does not protect TRUNCATE, and broad UPDATE policies allow financial/status
-- column tampering. Revoke all client table privileges, then restore SELECT only
-- for authenticated users; guarded SECURITY DEFINER RPCs own all writes.
revoke all privileges on table public.orders, public.order_items, public.payments
  from public, anon, authenticated;
grant select on table public.orders, public.order_items, public.payments
  to authenticated;
