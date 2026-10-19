-- DinePulse Phase 9: idempotent POS order creation for offline queue sync.
-- Phase 10 reports use the existing orders, order_items and payments tables.

alter table public.orders
  add column if not exists client_order_id text;

create unique index if not exists uq_orders_branch_client_order_id
  on public.orders(branch_id, client_order_id)
  where client_order_id is not null;

create or replace function public.create_pos_order(
  p_branch_id uuid,
  p_client_order_id text,
  p_order_type public.order_type,
  p_table_id uuid,
  p_items jsonb,
  p_notes text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_line jsonb;
  v_menu_item public.menu_items%rowtype;
  v_quantity numeric(10,2);
  v_line_subtotal numeric(12,2);
  v_line_tax numeric(12,2);
  v_subtotal numeric(12,2) := 0;
  v_tax numeric(12,2) := 0;
  v_item_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.user_has_branch_role(
    p_branch_id,
    array['OWNER','ADMIN','MANAGER','CASHIER','WAITER']::public.membership_role[]
  ) then
    raise exception 'Order creation permission required' using errcode = '42501';
  end if;
  if p_client_order_id is null or length(trim(p_client_order_id)) < 8 or length(p_client_order_id) > 100 then
    raise exception 'A valid client order id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one order item is required';
  end if;
  if p_table_id is not null and not exists (
    select 1 from public.restaurant_tables
    where id = p_table_id and branch_id = p_branch_id and is_active = true
  ) then
    raise exception 'Table not found in this branch';
  end if;

  -- The unique key makes retries safe when a browser reconnects after a timeout.
  insert into public.orders(
    branch_id, client_order_id, order_type, table_id, status, notes, created_by
  )
  values (
    p_branch_id, trim(p_client_order_id), p_order_type, p_table_id, 'OPEN', p_notes, auth.uid()
  )
  on conflict (branch_id, client_order_id) where client_order_id is not null
  do nothing
  returning * into v_order;

  if not found then
    select * into v_order
    from public.orders
    where branch_id = p_branch_id and client_order_id = trim(p_client_order_id);
    if not found then raise exception 'Could not resolve idempotent order retry'; end if;
    return jsonb_build_object('order', to_jsonb(v_order), 'duplicate', true);
  end if;

  for v_line in select value from jsonb_array_elements(p_items) loop
    v_item_count := v_item_count + 1;
    if v_item_count > 100 then raise exception 'An order cannot contain more than 100 lines'; end if;
    if coalesce(v_line->>'menu_item_id','') = '' then raise exception 'Each order line requires menu_item_id'; end if;
    v_quantity := (v_line->>'quantity')::numeric;
    if v_quantity <= 0 or v_quantity > 1000 then raise exception 'Invalid order quantity'; end if;

    select * into v_menu_item
    from public.menu_items
    where id = (v_line->>'menu_item_id')::uuid
      and branch_id = p_branch_id
      and is_active = true
      and is_available = true;
    if not found then raise exception 'Menu item not found or unavailable'; end if;

    v_line_subtotal := round(v_menu_item.price * v_quantity, 2);
    v_line_tax := round(v_line_subtotal * coalesce(v_menu_item.tax_rate, 0) / 100, 2);
    insert into public.order_items(
      order_id, menu_item_id, item_name, quantity, unit_price, tax_amount, line_total, kitchen_status
    )
    values (
      v_order.id, v_menu_item.id, v_menu_item.name, v_quantity,
      v_menu_item.price, v_line_tax, v_line_subtotal + v_line_tax, 'NEW'
    );
    v_subtotal := v_subtotal + v_line_subtotal;
    v_tax := v_tax + v_line_tax;
  end loop;

  update public.orders
  set subtotal = v_subtotal, tax_amount = v_tax, grand_total = v_subtotal + v_tax,
      status = 'OPEN'
  where id = v_order.id
  returning * into v_order;

  return jsonb_build_object('order', to_jsonb(v_order), 'duplicate', false);
end;
$$;

grant execute on function public.create_pos_order(uuid,text,public.order_type,uuid,jsonb,text) to authenticated;
