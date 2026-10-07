-- DinePulse Phase 5 + 6: POS/KOT numbering and billing indexes
create sequence if not exists public.order_number_seq;
create sequence if not exists public.kot_number_seq;
create or replace function public.assign_order_numbers()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.order_number is null then new.order_number := nextval('public.order_number_seq'); end if;
  if new.kot_number is null then new.kot_number := nextval('public.kot_number_seq'); end if;
  return new;
end $$;
drop trigger if exists trg_assign_order_numbers on public.orders;
create trigger trg_assign_order_numbers before insert on public.orders for each row execute function public.assign_order_numbers();
create index if not exists idx_orders_branch_status_created on public.orders(branch_id,status,created_at desc);
create index if not exists idx_orders_branch_order_number on public.orders(branch_id,order_number desc);
create index if not exists idx_order_items_kitchen_status on public.order_items(kitchen_status,created_at);
create index if not exists idx_payments_order on public.payments(order_id,created_at desc);
