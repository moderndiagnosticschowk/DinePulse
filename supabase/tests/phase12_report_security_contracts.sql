-- Phase 12 report security/performance preflight.
-- Run read-only against staging after migration 0012 and before branch-isolation browser tests.
-- This checks RLS, expected SELECT policy contracts, payment timestamp availability,
-- and the indexes used by report date filters/pagination. It does NOT prove row isolation.

do $$
declare
  v_table text;
  v_rls boolean;
  v_policy_count integer;
  v_expected record;
  v_index text;
  v_index_def text;
  v_index_valid boolean;
begin
  foreach v_table in array array['branch_memberships','orders','order_items','payments'] loop
    select c.relrowsecurity
      into v_rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = v_table;

    if not coalesce(v_rls, false) then
      raise exception 'RLS is not enabled on public.%', v_table;
    end if;
  end loop;

  for v_expected in
    select * from (values
      ('branch_memberships','memberships_select_self'),
      ('orders','orders_select'),
      ('order_items','order_items_select'),
      ('payments','payments_select')
    ) as expected(tablename, policyname)
  loop
    select count(*) into v_policy_count
    from pg_policies
    where schemaname = 'public'
      and tablename = v_expected.tablename
      and policyname = v_expected.policyname
      and cmd = 'SELECT'
      and 'authenticated' = any(roles);

    if v_policy_count <> 1 then
      raise exception 'Expected authenticated SELECT policy %.% is missing or changed',
        v_expected.tablename, v_expected.policyname;
    end if;
  end loop;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payments' and column_name = 'paid_at'
  ) then
    raise exception 'payments.paid_at is required for period-correct payment mix';
  end if;

  foreach v_index in array array[
    'idx_orders_branch_created_report',
    'idx_orders_branch_paid_at_report',
    'idx_order_items_order_report',
    'idx_payments_paid_at_report'
  ] loop
    if to_regclass('public.' || v_index) is null then
      raise exception 'Required report index public.% is missing', v_index;
    end if;
  end loop;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'created_at'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'paid_at'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payments' and column_name = 'status'
  ) then
    raise exception 'Required order/payment reporting timestamp or status columns are missing';
  end if;

  foreach v_index in array array[
    'idx_orders_branch_created_report',
    'idx_orders_branch_paid_at_report',
    'idx_order_items_order_report',
    'idx_payments_paid_at_report'
  ] loop
    select i.indisvalid, pg_get_indexdef(i.indexrelid)
      into v_index_valid, v_index_def
    from pg_index i
    where i.indexrelid = to_regclass('public.' || v_index);

    if not coalesce(v_index_valid, false) then
      raise exception 'Report index public.% exists but is not valid', v_index;
    end if;
  end loop;

  select pg_get_indexdef('public.idx_orders_branch_created_report'::regclass)
    into v_index_def;
  if position('(branch_id, created_at DESC, id)' in v_index_def) = 0 then
    raise exception 'Recent-orders index must cover branch_id, created_at DESC, id';
  end if;

  select pg_get_indexdef('public.idx_orders_branch_paid_at_report'::regclass)
    into v_index_def;
  if position('(branch_id, paid_at DESC, id)' in v_index_def) = 0
    or position('status' in lower(v_index_def)) = 0 then
    raise exception 'Paid-orders index must cover branch_id, paid_at and the PAID predicate';
  end if;

  select pg_get_indexdef('public.idx_order_items_order_report'::regclass)
    into v_index_def;
  if position('(order_id, id)' in v_index_def) = 0 then
    raise exception 'Order-item pagination index must cover order_id, id';
  end if;

  select pg_get_indexdef('public.idx_payments_paid_at_report'::regclass)
    into v_index_def;
  if position('(paid_at DESC, id)' in v_index_def) = 0
    or position('INCLUDE (order_id, payment_method, amount)' in v_index_def) = 0
    or position('COMPLETED' in v_index_def) = 0 then
    raise exception 'Payment index must cover paid_at, stable id order, selected columns and COMPLETED predicate';
  end if;
end;
$$;

select 'Phase 12 report RLS and index preflight passed' as result;
