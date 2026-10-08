-- DinePulse Phase 7 + 8 inventory, recipes, suppliers and purchases
alter table public.purchases add column if not exists status text not null default 'DRAFT';
alter table public.purchases add column if not exists paid_amount numeric(12,2) not null default 0;
alter table public.purchases add column if not exists received_at timestamptz;
alter table public.purchases add column if not exists received_by uuid references public.profiles(id);
alter table public.purchases add column if not exists idempotency_key text;
create unique index if not exists uq_purchases_branch_invoice on public.purchases(branch_id,invoice_number) where invoice_number is not null;
create unique index if not exists uq_purchases_branch_idempotency on public.purchases(branch_id,idempotency_key) where idempotency_key is not null;
create index if not exists idx_inventory_branch_stock on public.inventory_items(branch_id,current_stock,minimum_stock);
create index if not exists idx_stock_movements_branch_item_created on public.stock_movements(branch_id,inventory_item_id,created_at desc);
create index if not exists idx_recipes_branch_menu on public.recipes(branch_id,menu_item_id);
create index if not exists idx_purchases_branch_date on public.purchases(branch_id,purchase_date desc);
create or replace function public.adjust_inventory_stock(p_branch_id uuid,p_inventory_item_id uuid,p_quantity numeric,p_movement_type text,p_reference_type text default null,p_reference_id uuid default null,p_notes text default null,p_created_by uuid default null) returns public.stock_movements language plpgsql security invoker set search_path=public as $$
declare v_move public.stock_movements;
begin
 if p_quantity=0 then raise exception 'Quantity cannot be zero'; end if;
 if not exists(select 1 from public.inventory_items where id=p_inventory_item_id and branch_id=p_branch_id) then raise exception 'Inventory item not found'; end if;
 update public.inventory_items set current_stock=current_stock+p_quantity,updated_at=now() where id=p_inventory_item_id and branch_id=p_branch_id;
 insert into public.stock_movements(branch_id,inventory_item_id,movement_type,quantity,reference_type,reference_id,notes,created_by) values(p_branch_id,p_inventory_item_id,p_movement_type,p_quantity,p_reference_type,p_reference_id,p_notes,p_created_by) returning * into v_move;
 return v_move;
end $$;
create or replace function public.receive_purchase(p_purchase_id uuid,p_branch_id uuid,p_user_id uuid) returns public.purchases language plpgsql security invoker set search_path=public as $$
declare v_purchase public.purchases; v_item record;
begin
 select * into v_purchase from public.purchases where id=p_purchase_id and branch_id=p_branch_id for update;
 if not found then raise exception 'Purchase not found'; end if;
 if v_purchase.status='RECEIVED' then return v_purchase; end if;
 if v_purchase.status='CANCELLED' then raise exception 'Cancelled purchase cannot be received'; end if;
 for v_item in select * from public.purchase_items where purchase_id=p_purchase_id loop
   perform public.adjust_inventory_stock(p_branch_id,v_item.inventory_item_id,v_item.quantity,'PURCHASE','PURCHASE',p_purchase_id,'Purchase received',p_user_id);
   update public.inventory_items set cost_per_unit=v_item.unit_cost,updated_at=now() where id=v_item.inventory_item_id and branch_id=p_branch_id;
 end loop;
 update public.purchases set status='RECEIVED',received_at=now(),received_by=p_user_id,updated_at=now() where id=p_purchase_id returning * into v_purchase;
 return v_purchase;
end $$;
create or replace function public.consume_order_stock(p_order_id uuid,p_branch_id uuid,p_user_id uuid) returns integer language plpgsql security invoker set search_path=public as $$
declare v_order_item record; v_ing record; v_count integer:=0;
begin
 for v_order_item in select oi.* from public.order_items oi join public.orders o on o.id=oi.order_id where oi.order_id=p_order_id and o.branch_id=p_branch_id loop
   for v_ing in select ri.inventory_item_id,ri.quantity,r.yield_quantity from public.recipes r join public.recipe_ingredients ri on ri.recipe_id=r.id where r.branch_id=p_branch_id and r.menu_item_id=v_order_item.menu_item_id loop
     perform public.adjust_inventory_stock(p_branch_id,v_ing.inventory_item_id,-(v_ing.quantity/nullif(v_ing.yield_quantity,0))*v_order_item.quantity,'SALE','ORDER',p_order_id,'Recipe consumption',p_user_id);
     v_count:=v_count+1;
   end loop;
 end loop;
 return v_count;
end $$;
revoke all on function public.adjust_inventory_stock(uuid,uuid,numeric,text,text,uuid,text,uuid) from public;
revoke all on function public.receive_purchase(uuid,uuid,uuid) from public;
revoke all on function public.consume_order_stock(uuid,uuid,uuid) from public;
grant execute on function public.adjust_inventory_stock(uuid,uuid,numeric,text,text,uuid,text,uuid) to authenticated;
grant execute on function public.receive_purchase(uuid,uuid,uuid) to authenticated;
grant execute on function public.consume_order_stock(uuid,uuid,uuid) to authenticated;