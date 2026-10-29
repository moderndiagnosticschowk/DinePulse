-- Phase 11 post-migration contract assertions.
-- Run ONLY against a disposable/staging Supabase database after migration 0011.
-- This script is read-only and raises an exception when a required contract fails.

do $$
declare
  v_proc regprocedure;
  v_rls_enabled boolean;
begin
  v_proc := to_regprocedure('public.adjust_inventory_stock(uuid,uuid,numeric,text,text,uuid,text,uuid)');
  if v_proc is null or (select prorettype from pg_proc where oid = v_proc) <> 'public.stock_movements'::regtype then
    raise exception 'adjust_inventory_stock signature/return contract mismatch';
  end if;

  v_proc := to_regprocedure('public.create_purchase(uuid,uuid,uuid,text,date,numeric,text,numeric,text,jsonb,text)');
  if v_proc is null or (select prorettype from pg_proc where oid = v_proc) <> 'jsonb'::regtype then
    raise exception 'create_purchase signature/return contract mismatch';
  end if;

  v_proc := to_regprocedure('public.receive_purchase(uuid,uuid,uuid)');
  if v_proc is null or (select prorettype from pg_proc where oid = v_proc) <> 'public.purchases'::regtype then
    raise exception 'receive_purchase signature/return contract mismatch';
  end if;

  v_proc := to_regprocedure('public.consume_order_stock(uuid,uuid,uuid)');
  if v_proc is null or (select prorettype from pg_proc where oid = v_proc) <> 'integer'::regtype then
    raise exception 'consume_order_stock signature/return contract mismatch';
  end if;

  -- Billing can be performed by a cashier, but stock must only be consumed for paid orders.
  -- This source-contract assertion complements, but does not replace, behavioral tests.
  if position('v_order.status <> ''paid''' in lower(pg_get_functiondef(
    'public.consume_order_stock(uuid,uuid,uuid)'::regprocedure
  ))) = 0 then
    raise exception 'consume_order_stock must reject unpaid orders';
  end if;
  if position('cashier' in lower(pg_get_functiondef(
    'public.consume_order_stock(uuid,uuid,uuid)'::regprocedure
  ))) = 0 then
    raise exception 'consume_order_stock must support authorized cashier billing';
  end if;

  if to_regclass('public.order_stock_consumptions') is null then
    raise exception 'order_stock_consumptions ledger table is missing';
  end if;

  select c.relrowsecurity into v_rls_enabled
  from pg_class c
  where c.oid = 'public.order_stock_consumptions'::regclass;
  if not coalesce(v_rls_enabled, false) then
    raise exception 'RLS must be enabled on order_stock_consumptions';
  end if;

  if has_table_privilege('anon', 'public.order_stock_consumptions', 'SELECT')
    or has_table_privilege('anon', 'public.order_stock_consumptions', 'INSERT')
    or has_table_privilege('anon', 'public.order_stock_consumptions', 'UPDATE')
    or has_table_privilege('anon', 'public.order_stock_consumptions', 'DELETE') then
    raise exception 'anon must not have direct privileges on order_stock_consumptions';
  end if;

  if has_table_privilege('authenticated', 'public.order_stock_consumptions', 'SELECT')
    or has_table_privilege('authenticated', 'public.order_stock_consumptions', 'INSERT')
    or has_table_privilege('authenticated', 'public.order_stock_consumptions', 'UPDATE')
    or has_table_privilege('authenticated', 'public.order_stock_consumptions', 'DELETE') then
    raise exception 'authenticated must not have direct privileges on order_stock_consumptions';
  end if;

  if has_function_privilege('anon', 'public.adjust_inventory_stock(uuid,uuid,numeric,text,text,uuid,text,uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.create_purchase(uuid,uuid,uuid,text,date,numeric,text,numeric,text,jsonb,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.receive_purchase(uuid,uuid,uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.consume_order_stock(uuid,uuid,uuid)', 'EXECUTE') then
    raise exception 'anon must not execute inventory/purchase RPCs';
  end if;

  if not has_function_privilege('authenticated', 'public.adjust_inventory_stock(uuid,uuid,numeric,text,text,uuid,text,uuid)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.create_purchase(uuid,uuid,uuid,text,date,numeric,text,numeric,text,jsonb,text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.receive_purchase(uuid,uuid,uuid)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.consume_order_stock(uuid,uuid,uuid)', 'EXECUTE') then
    raise exception 'authenticated must retain execute privileges on the four guarded RPCs';
  end if;
end;
$$;

select 'Phase 11 database contract assertions passed' as result;
