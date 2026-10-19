-- Phase 7/8 hardening: atomic inventory adjustments, purchases and recipe consumption.
-- Apply after 0002_phase3_database_phase4_menu.sql.

alter table public.purchases
  add column if not exists status text not null default 'DRAFT',
  add column if not exists paid_amount numeric(12,2) not null default 0,
  add column if not exists idempotency_key text;

create unique index if not exists uq_purchases_branch_idempotency
  on public.purchases(branch_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_purchase_items_purchase_id on public.purchase_items(purchase_id);
create index if not exists idx_stock_movements_reference on public.stock_movements(branch_id, reference_type, reference_id);

create or replace function public.adjust_inventory_stock(
  p_branch_id uuid,
  p_inventory_item_id uuid,
  p_quantity numeric,
  p_movement_type text,
  p_notes text default null,
  p_created_by uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item public.inventory_items%rowtype;
  v_type public.stock_movement_type;
  v_delta numeric(14,3);
  v_movement public.stock_movements%rowtype;
begin
  if auth.uid() is null or not public.user_has_branch_role(
    p_branch_id, array['OWNER','ADMIN','MANAGER','INVENTORY_MANAGER']::public.membership_role[]
  ) then raise exception 'Inventory manager permission required' using errcode = '42501'; end if;
  if p_quantity is null or p_quantity = 0 then raise exception 'Quantity must be non-zero'; end if;
  if p_movement_type not in ('ADJUSTMENT_IN','ADJUSTMENT_OUT','WASTE') then raise exception 'Invalid movement type'; end if;

  select * into v_item from public.inventory_items
  where id=p_inventory_item_id and branch_id=p_branch_id and is_active=true
  for update;
  if not found then raise exception 'Inventory item not found in this branch'; end if;

  v_delta := case when p_quantity > 0 then p_quantity else abs(p_quantity) end;
  if p_quantity > 0 then
    v_type := 'ADJUSTMENT_IN';
  elsif p_movement_type = 'WASTE' then
    v_type := 'WASTE';
  else
    v_type := 'ADJUSTMENT_OUT';
  end if;
  if v_item.current_stock + p_quantity < 0 then raise exception 'Insufficient stock'; end if;

  update public.inventory_items set current_stock=current_stock+p_quantity where id=v_item.id returning * into v_item;
  insert into public.stock_movements(branch_id,inventory_item_id,movement_type,quantity,reference_type,reference_id,notes,created_by)
  values(p_branch_id,v_item.id,v_type,v_delta,'ADJUSTMENT',null,left(p_notes,500),coalesce(p_created_by,auth.uid()))
  returning * into v_movement;

  return jsonb_build_object('item',to_jsonb(v_item),'movement',to_jsonb(v_movement));
end;
$$;

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
  v_total_tax numeric(12,2) := coalesce(p_tax_amount,0);
begin
  if auth.uid() is null or not public.user_has_branch_role(
    p_branch_id, array['OWNER','ADMIN','MANAGER','INVENTORY_MANAGER']::public.membership_role[]
  ) then raise exception 'Purchase permission required' using errcode = '42501'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one purchase item is required'; end if;
  if coalesce(p_tax_amount,0)<0 or coalesce(p_paid_amount,0)<0 then raise exception 'Tax and paid amount cannot be negative'; end if;

  if p_supplier_id is not null and not exists(
    select 1 from public.suppliers where id=p_supplier_id and branch_id=p_branch_id
  ) then raise exception 'Supplier not found in this branch'; end if;

  if p_idempotency_key is not null then
    select * into v_purchase from public.purchases where branch_id=p_branch_id and idempotency_key=p_idempotency_key for update;
    if found then return jsonb_build_object('purchase',to_jsonb(v_purchase),'duplicate',true); end if;
  end if;

  for v_line in select value from jsonb_array_elements(p_items) loop
    v_item_id := (v_line->>'inventory_item_id')::uuid;
    v_qty := (v_line->>'quantity')::numeric;
    v_cost := (v_line->>'unit_cost')::numeric;
    v_line_tax := coalesce((v_line->>'tax_amount')::numeric,0);
    if v_qty<=0 or v_cost<0 or v_line_tax<0 then raise exception 'Invalid purchase line quantity, cost or tax'; end if;
    if not exists(select 1 from public.inventory_items where id=v_item_id and branch_id=p_branch_id and is_active=true) then
      raise exception 'Inventory item not found in this branch';
    end if;
    v_subtotal := v_subtotal + round(v_qty*v_cost,2);
    v_total_tax := v_total_tax + v_line_tax;
  end loop;

  insert into public.purchases(branch_id,supplier_id,invoice_number,purchase_date,subtotal,tax_amount,total_amount,payment_status,paid_amount,notes,created_by,idempotency_key,status)
  values(p_branch_id,p_supplier_id,nullif(trim(p_invoice_number),''),coalesce(p_purchase_date,current_date),v_subtotal,v_total_tax,v_subtotal+v_total_tax,coalesce(p_payment_status,'PENDING'),coalesce(p_paid_amount,0),p_notes,coalesce(p_user_id,auth.uid()),p_idempotency_key,'DRAFT')
  returning * into v_purchase;

  for v_line in select value from jsonb_array_elements(p_items) loop
    insert into public.purchase_items(purchase_id,inventory_item_id,quantity,unit_cost,tax_amount,total_amount)
    values(v_purchase.id,(v_line->>'inventory_item_id')::uuid,(v_line->>'quantity')::numeric,(v_line->>'unit_cost')::numeric,coalesce((v_line->>'tax_amount')::numeric,0),round((v_line->>'quantity')::numeric*(v_line->>'unit_cost')::numeric,2)+coalesce((v_line->>'tax_amount')::numeric,0));
  end loop;

  return jsonb_build_object('purchase',to_jsonb(v_purchase),'duplicate',false);
end;
$$;

-- Drop the previous signature first because PostgreSQL cannot replace a function's return type.
drop function if exists public.receive_purchase(uuid, uuid, uuid);

create function public.receive_purchase(
  p_purchase_id uuid,
  p_branch_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_purchase public.purchases%rowtype;
  v_line record;
  v_movement_count integer := 0;
begin
  if auth.uid() is null or not public.user_has_branch_role(
    p_branch_id, array['OWNER','ADMIN','MANAGER','INVENTORY_MANAGER']::public.membership_role[]
  ) then raise exception 'Purchase permission required' using errcode = '42501'; end if;

  select * into v_purchase from public.purchases
  where id=p_purchase_id and branch_id=p_branch_id for update;
  if not found then raise exception 'Purchase not found in this branch'; end if;
  if v_purchase.status='RECEIVED' then return jsonb_build_object('purchase',to_jsonb(v_purchase),'duplicate',true,'movements',0); end if;

  for v_line in
    select pi.* from public.purchase_items pi where pi.purchase_id=v_purchase.id
  loop
    update public.inventory_items
      set current_stock=current_stock+v_line.quantity,
          cost_per_unit=case when current_stock+v_line.quantity > 0
            then ((current_stock*cost_per_unit)+(v_line.quantity*v_line.unit_cost))/(current_stock+v_line.quantity)
            else v_line.unit_cost end
      where id=v_line.inventory_item_id and branch_id=p_branch_id and is_active=true;
    if not found then raise exception 'Purchase contains an invalid inventory item'; end if;
    insert into public.stock_movements(branch_id,inventory_item_id,movement_type,quantity,reference_type,reference_id,notes,created_by)
    values(p_branch_id,v_line.inventory_item_id,'PURCHASE',v_line.quantity,'PURCHASE',v_purchase.id,'Purchase received',coalesce(p_user_id,auth.uid()));
    v_movement_count := v_movement_count+1;
  end loop;

  update public.purchases set status='RECEIVED' where id=v_purchase.id returning * into v_purchase;
  return jsonb_build_object('purchase',to_jsonb(v_purchase),'duplicate',false,'movements',v_movement_count);
end;
$$;

-- PostgreSQL cannot change an existing function's return type with CREATE OR REPLACE.
drop function if exists public.consume_order_stock(uuid, uuid, uuid);

create function public.consume_order_stock(
  p_order_id uuid,
  p_branch_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_line record;
  v_needed numeric(14,3);
  v_stock numeric(14,3);
  v_count integer := 0;
begin
  if auth.uid() is null or not public.user_has_branch_role(
    p_branch_id, array['OWNER','ADMIN','MANAGER','CASHIER','INVENTORY_MANAGER']::public.membership_role[]
  ) then raise exception 'Order stock permission required' using errcode = '42501'; end if;

  select * into v_order from public.orders where id=p_order_id and branch_id=p_branch_id for update;
  if not found then raise exception 'Order not found in this branch'; end if;
  if exists(select 1 from public.stock_movements where branch_id=p_branch_id and reference_type='ORDER_CONSUMPTION' and reference_id=p_order_id) then
    return jsonb_build_object('duplicate',true,'movements',0);
  end if;

  for v_line in
    select oi.quantity as sold_qty, ri.inventory_item_id, ri.quantity as recipe_qty, r.yield_quantity, ii.name
    from public.order_items oi
    join public.recipes r on r.menu_item_id=oi.menu_item_id and r.branch_id=p_branch_id
    join public.recipe_ingredients ri on ri.recipe_id=r.id
    join public.inventory_items ii on ii.id=ri.inventory_item_id and ii.branch_id=p_branch_id
    where oi.order_id=p_order_id
    order by ri.inventory_item_id
  loop
    v_needed := (v_line.recipe_qty*v_line.sold_qty)/v_line.yield_quantity;
    select current_stock into v_stock from public.inventory_items where id=v_line.inventory_item_id and branch_id=p_branch_id for update;
    if v_stock is null or v_stock < v_needed then raise exception 'Insufficient stock for %',v_line.name; end if;
    update public.inventory_items set current_stock=current_stock-v_needed where id=v_line.inventory_item_id and branch_id=p_branch_id;
    insert into public.stock_movements(branch_id,inventory_item_id,movement_type,quantity,reference_type,reference_id,notes,created_by)
    values(p_branch_id,v_line.inventory_item_id,'SALE',v_needed,'ORDER_CONSUMPTION',p_order_id,'Recipe consumption for order',coalesce(p_user_id,auth.uid()));
    v_count := v_count+1;
  end loop;
  return jsonb_build_object('duplicate',false,'movements',v_count);
end;
$$;

grant execute on function public.adjust_inventory_stock(uuid,uuid,numeric,text,text,uuid) to authenticated;
grant execute on function public.create_purchase(uuid,uuid,uuid,text,date,numeric,text,numeric,text,jsonb,text) to authenticated;
grant execute on function public.receive_purchase(uuid,uuid,uuid) to authenticated;
grant execute on function public.consume_order_stock(uuid,uuid,uuid) to authenticated;
