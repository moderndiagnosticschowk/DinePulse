-- Phase 12 report security preflight.
-- Run read-only against staging before branch-isolation browser tests.
-- This checks RLS is enabled and the expected SELECT policy contracts exist;
-- it does NOT replace tests using real users from two separate branches.

do $$
declare
  v_table text;
  v_rls boolean;
  v_policy_count integer;
  v_expected record;
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
end;
$$;

select 'Phase 12 report RLS preflight passed' as result;
