-- Phase 11 post-migration contract assertions.
-- Run ONLY against a disposable/staging Supabase database after migration 0011.
-- This script is read-only and raises an exception when a required contract fails.

do $$
declare
  v_proc regprocedure;
  v_rls_enabled boolean;
  v_security_definer boolean;
  v_function_config text;
  v_function record;
  v_function_def text;
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

  v_proc := to_regprocedure('public.settle_order_payment(uuid,uuid,public.payment_method,text,numeric,text)');
  if v_proc is null or (select prorettype from pg_proc where oid = v_proc) <> 'jsonb'::regtype then
    raise exception 'settle_order_payment signature/return contract mismatch';
  end if;

  -- All mutating RPCs use a fixed trusted search_path with pg_catalog first.
  for v_function in
    select p.oid::regprocedure as signature, p.proconfig
    from pg_proc p
    where p.oid in (
      'public.adjust_inventory_stock(uuid,uuid,numeric,text,text,uuid,text,uuid)'::regprocedure,
      'public.create_purchase(uuid,uuid,uuid,text,date,numeric,text,numeric,text,jsonb,text)'::regprocedure,
      'public.receive_purchase(uuid,uuid,uuid)'::regprocedure,
      'public.consume_order_stock(uuid,uuid,uuid)'::regprocedure,
      'public.settle_order_payment(uuid,uuid,public.payment_method,text,numeric,text)'::regprocedure
    )
  loop
    v_function_config := replace(coalesce(array_to_string(v_function.proconfig, ','), ''), ' ', '');
    if position('search_path=pg_catalog,public' in v_function_config) = 0 then
      raise exception 'Function % must use search_path=pg_catalog,public', v_function.signature;
    end if;
  end loop;

  -- Billing can be performed by a cashier, but stock must only be consumed for paid orders.
  v_function_def := lower(pg_get_functiondef(
    'public.consume_order_stock(uuid,uuid,uuid)'::regprocedure
  ));
  if position('v_order.status <> ''paid''' in v_function_def) = 0 then
    raise exception 'consume_order_stock must reject unpaid orders';
  end if;
  if position('v_order.status <> ''paid''' in v_function_def)
    > position('-- backfill a marker only after confirming the order is paid' in v_function_def) then
    raise exception 'consume_order_stock must check PAID status before creating a legacy-consumption marker';
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

  if has_function_privilege('anon', 'public.settle_order_payment(uuid,uuid,public.payment_method,text,numeric,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.adjust_inventory_stock(uuid,uuid,numeric,text,text,uuid,text,uuid)', 'EXECUTE')
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

  -- The stock_movements schema stores positive magnitudes; signed inputs affect stock,
  -- while movement_type identifies the direction. This prevents the live CHECK from failing.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.stock_movements'::regclass
      and conname = 'stock_movements_quantity_check'
      and contype = 'c'
  ) then
    raise exception 'stock_movements positive-quantity constraint is missing';
  end if;
  if position('abs(p_quantity)' in lower(pg_get_functiondef(
    'public.adjust_inventory_stock(uuid,uuid,numeric,text,text,uuid,text,uuid)'::regprocedure
  ))) = 0 then
    raise exception 'adjust_inventory_stock must persist positive movement magnitudes';
  end if;
  if position('''sale'', v_needed' in lower(pg_get_functiondef(
    'public.consume_order_stock(uuid,uuid,uuid)'::regprocedure
  ))) = 0 then
    raise exception 'consume_order_stock must persist positive movement magnitudes';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payments' and column_name = 'idempotency_key'
  ) then
    raise exception 'payments.idempotency_key is required for safe payment retries';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'payments'
      and indexname = 'uq_payments_order_idempotency'
      and indexdef ilike 'CREATE UNIQUE INDEX%'
      and position('(order_id, idempotency_key)' in indexdef) > 0
  ) then
    raise exception 'payments requires a unique order/idempotency key index';
  end if;

  select prosecdef, replace(coalesce(array_to_string(proconfig, ','), ''), ' ', '')
    into v_security_definer, v_function_config
  from pg_proc
  where oid = 'public.settle_order_payment(uuid,uuid,public.payment_method,text,numeric,text)'::regprocedure;
  if not coalesce(v_security_definer, false)
    or position('search_path=pg_catalog,public' in v_function_config) = 0 then
    raise exception 'settle_order_payment must be SECURITY DEFINER with a fixed trusted search_path';
  end if;
  v_function_def := lower(pg_get_functiondef(
    'public.settle_order_payment(uuid,uuid,public.payment_method,text,numeric,text)'::regprocedure
  ));
  if position('v_existing.amount <> v_due' in v_function_def) = 0
    or position('v_existing.reference_number is distinct from' in v_function_def) = 0
    or position('v_existing.status <> ''completed''' in v_function_def) = 0 then
    raise exception 'settle_order_payment must bind retries to the original amount, reference, and completed payment state';
  end if;
  if position('p_amount <> round(p_amount, 2)' in v_function_def) = 0
    or position('p_amount::text in (''nan'', ''infinity'', ''-infinity'')' in v_function_def) = 0 then
    raise exception 'settle_order_payment must reject over-precision and non-finite payment amounts at the database boundary';
  end if;
  if position('for update' in lower(pg_get_functiondef(
    'public.settle_order_payment(uuid,uuid,public.payment_method,text,numeric,text)'::regprocedure
  ))) = 0
    or position('consume_order_stock' in lower(pg_get_functiondef(
      'public.settle_order_payment(uuid,uuid,public.payment_method,text,numeric,text)'::regprocedure
    ))) = 0 then
    raise exception 'settle_order_payment must lock the order and consume stock in the same transaction';
  end if;
  if has_function_privilege('anon', 'public.settle_order_payment(uuid,uuid,public.payment_method,text,numeric,text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.settle_order_payment(uuid,uuid,public.payment_method,text,numeric,text)', 'EXECUTE') then
    raise exception 'settle_order_payment execution grants are incorrect';
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


  -- Existing helper functions remain available to authenticated RLS/application
  -- flows, but anonymous callers must not invoke SECURITY DEFINER helpers.
  if not exists (
    select 1 from pg_proc
    where oid = 'public.set_updated_at()'::regprocedure
      and position('search_path=pg_catalog,public' in replace(coalesce(array_to_string(proconfig, ','), ''), ' ', '')) > 0
  ) or not exists (
    select 1 from pg_proc
    where oid = 'public.get_current_user_id()'::regprocedure
      and position('search_path=pg_catalog,public' in replace(coalesce(array_to_string(proconfig, ','), ''), ' ', '')) > 0
  ) then
    raise exception 'Shared trigger/current-user helpers must pin search_path to pg_catalog, public';
  end if;

  if has_function_privilege('anon', 'public.complete_workspace_onboarding(text,text,text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.complete_workspace_onboarding(text,text,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.user_has_branch_access(uuid)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.user_has_branch_access(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.user_has_branch_role(uuid,public.membership_role[])', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.user_has_branch_role(uuid,public.membership_role[])', 'EXECUTE')
    or has_function_privilege('anon', 'public.user_has_company_access(uuid)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.user_has_company_access(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.user_is_branch_owner_or_admin(uuid)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.user_is_branch_owner_or_admin(uuid)', 'EXECUTE') then
    raise exception 'SECURITY DEFINER helper grants must deny anon while preserving authenticated RLS/application access';
  end if;

end;
$;

select 'Phase 11 database contract assertions passed' as result;
