-- Smart Restaurant POS: Phase 2 authentication/workspace schema
create extension if not exists pgcrypto;

do $$ begin
  create type public.membership_role as enum ('OWNER','ADMIN','MANAGER','CASHIER','WAITER','KITCHEN','INVENTORY_MANAGER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.branch_status as enum ('ACTIVE','INACTIVE');
exception when duplicate_object then null; end $$;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  gstin text,
  phone text,
  email text,
  address text,
  logo_url text,
  currency text not null default 'INR',
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  code text,
  phone text,
  email text,
  address text,
  gstin text,
  status public.branch_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.branch_memberships (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.membership_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(branch_id,user_id)
);

create index if not exists idx_branches_company_id on public.branches(company_id);
create index if not exists idx_memberships_user_id on public.branch_memberships(user_id);
create index if not exists idx_memberships_branch_id on public.branch_memberships(branch_id);

create or replace function public.get_current_user_id()
returns uuid language sql stable as $$ select auth.uid(); $$;

create or replace function public.user_has_branch_access(p_branch_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.branch_memberships bm
    where bm.branch_id = p_branch_id and bm.user_id = auth.uid() and bm.is_active = true
  );
$$;

create or replace function public.user_is_branch_owner_or_admin(p_branch_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.branch_memberships bm
    where bm.branch_id = p_branch_id and bm.user_id = auth.uid() and bm.is_active = true and bm.role in ('OWNER','ADMIN')
  );
$$;

create or replace function public.complete_workspace_onboarding(p_company_name text, p_branch_name text, p_full_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_company uuid;
  v_branch uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if coalesce(trim(p_company_name),'') = '' then raise exception 'Company name is required'; end if;
  if coalesce(trim(p_branch_name),'') = '' then raise exception 'Branch name is required'; end if;

  insert into public.profiles(id, full_name)
  values(v_user, nullif(trim(p_full_name),''))
  on conflict(id) do update set full_name = excluded.full_name, updated_at = now();

  select c.id into v_company
  from public.companies c
  join public.branches b on b.company_id = c.id
  join public.branch_memberships bm on bm.branch_id = b.id
  where bm.user_id = v_user and bm.role = 'OWNER'
  limit 1;

  if v_company is not null then
    return jsonb_build_object('company_id',v_company,'created',false);
  end if;

  insert into public.companies(name) values(trim(p_company_name)) returning id into v_company;
  insert into public.branches(company_id,name,code) values(v_company,trim(p_branch_name),'MAIN') returning id into v_branch;
  insert into public.branch_memberships(branch_id,user_id,role) values(v_branch,v_user,'OWNER');

  return jsonb_build_object('company_id',v_company,'branch_id',v_branch,'created',true);
end;
$$;

revoke all on function public.complete_workspace_onboarding(text,text,text) from public;
grant execute on function public.complete_workspace_onboarding(text,text,text) to authenticated;


alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.branches enable row level security;
alter table public.branch_memberships enable row level security;

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists companies_select_member on public.companies;
create policy companies_select_member on public.companies for select to authenticated using (
  exists (
    select 1 from public.branches b
    join public.branch_memberships bm on bm.branch_id=b.id
    where b.company_id=companies.id and bm.user_id=auth.uid() and bm.is_active=true
  )
);

drop policy if exists branches_select_member on public.branches;
create policy branches_select_member on public.branches for select to authenticated using (public.user_has_branch_access(id));
drop policy if exists branches_update_admin on public.branches;
create policy branches_update_admin on public.branches for update to authenticated using (public.user_is_branch_owner_or_admin(id)) with check (public.user_is_branch_owner_or_admin(id));

drop policy if exists memberships_select_self on public.branch_memberships;
create policy memberships_select_self on public.branch_memberships for select to authenticated using (user_id = auth.uid());
drop policy if exists memberships_select_admin on public.branch_memberships;
create policy memberships_select_admin on public.branch_memberships for select to authenticated using (public.user_is_branch_owner_or_admin(branch_id));

-- Keep write access to company/branch/membership bootstrap inside the SECURITY DEFINER RPC.
revoke insert, update, delete on public.companies from authenticated;
revoke insert, update, delete on public.branches from authenticated;
revoke insert, update, delete on public.branch_memberships from authenticated;
grant select on public.companies, public.branches, public.branch_memberships, public.profiles to authenticated;
grant update on public.profiles to authenticated;
