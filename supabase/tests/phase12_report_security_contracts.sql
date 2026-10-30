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
end;
$$;

select 'Phase 12 report RLS and index preflight passed' as result;
