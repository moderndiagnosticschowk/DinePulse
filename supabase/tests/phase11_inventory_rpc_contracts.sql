-- Phase 11 post-migration contract assertions.
-- Run ONLY against a disposable/staging Supabase database after migration 0011.
-- This script is read-only and raises an exception when a required contract fails.

do $$
declare
  v_proc regprocedure;
  v_rls_enabled boolean;
  v_security_definer boolean;
  v_function_config text;
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

  -- The concurrent create_purchase retry path depends on this branch-scoped unique key.
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'purchases'
      and indexdef ilike 'CREATE UNIQUE INDEX%'
      and position('(branch_id, idempotency_key)' in indexdef) > 0
      and indexdef ilike '%WHERE (idempotency_key IS NOT NULL)%'
  ) then
    raise exception 'purchases requires a unique branch_id/idempotency_key index';
  end if;

  -- Direct RPC calls must not bypass the signed-quantity rules enforced by the API.
  if position('p_quantity < 0' in lower(pg_get_functiondef(
    'public.adjust_inventory_stock(uuid,uuid,numeric,text,text,uuid,text,uuid)'::regprocedure
  ))) = 0
    or position('p_quantity > 0' in lower(pg_get_functiondef(
      'public.adjust_inventory_stock(uuid,uuid,numeric,text,text,uuid,text,uuid)'::regprocedure
    ))) = 0 then
    raise exception 'adjust_inventory_stock must enforce movement direction in SQL';
  end if;

  -- General adjustment stays SECURITY INVOKER; only the ledger-owning order RPC
  -- is SECURITY DEFINER, and it must pin search_path to trusted schemas.
  select prosecdef, coalesce(array_to_string(proconfig, ','), '')
    into v_security_definer, v_function_config
  from pg_proc
  where oid = 'public.adjust_inventory_stock(uuid,uuid,numeric,text,text,uuid,text,uuid)'::regprocedure;
  if coalesce(v_security_definer, true) then
    raise exception 'adjust_inventory_stock must remain SECURITY INVOKER';
  end if;

  select prosecdef, replace(coalesce(array_to_string(proconfig, ','), ''), ' ', '')
    into v_security_definer, v_function_config
  from pg_proc
  where oid = 'public.consume_order_stock(uuid,uuid,uuid)'::regprocedure;
  if not coalesce(v_security_definer, false)
    or position('search_path=pg_catalog,public' in v_function_config) = 0 then
    raise exception 'consume_order_stock must be SECURITY DEFINER with a fixed trusted search_path';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.order_stock_consumptions'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (order_id)'
  ) then
    raise exception 'order_stock_consumptions.order_id must be the primary key';
  end if;

  if position('left(p_notes, 500), v_actor' in lower(pg_get_functiondef(
    'public.adjust_inventory_stock(uuid,uuid,numeric,text,text,uuid,text,uuid)'::regprocedure
  ))) = 0 then
    raise exception 'adjust_inventory_stock must write auth.uid()-derived v_actor as created_by';
  end if;
  if position('received_by = v_actor' in lower(pg_get_functiondef(
    'public.receive_purchase(uuid,uuid,uuid)'::regprocedure
  ))) = 0 then
    raise exception 'receive_purchase must write auth.uid()-derived v_actor as received_by';
  end if;

end;
$;

select 'Phase 11 database contract assertions passed' as result;
