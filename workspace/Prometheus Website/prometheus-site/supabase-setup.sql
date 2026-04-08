-- ============================================================
-- Prometheus Supabase Schema Setup
-- Paste this entire file into: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- ── 1. Profiles table ────────────────────────────────────────
create table if not exists public.profiles (
  id               uuid references auth.users(id) on delete cascade primary key,
  display_name     text,
  stripe_customer_id text,
  is_admin         boolean default false,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Service role can do anything (needed for webhook updates)
create policy "Service role full access on profiles"
  on public.profiles for all
  using (auth.role() = 'service_role');

-- ── 2. Auto-create profile on new signup ─────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── 3. Subscriptions table ───────────────────────────────────
create table if not exists public.subscriptions (
  id                    text primary key,  -- Stripe subscription ID
  user_id               uuid references auth.users(id) on delete cascade not null,
  status                text not null,     -- active | trialing | past_due | canceled
  price_id              text,
  current_period_end    timestamptz,
  cancel_at_period_end  boolean default false,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

alter table public.subscriptions enable row level security;

create policy "Users can view their own subscriptions"
  on public.subscriptions for select
  using (auth.uid() = user_id);

create policy "Service role full access on subscriptions"
  on public.subscriptions for all
  using (auth.role() = 'service_role');

-- ── 4. Seed the admin account profile ───────────────────────
-- (The trigger only fires on NEW signups, so insert manually for existing users)
insert into public.profiles (id, display_name, is_admin)
values ('8f899faf-5716-4dec-ba8c-30c20765348c', 'Admin', true)
on conflict (id) do update set display_name = 'Admin', is_admin = true;

-- ── Done ─────────────────────────────────────────────────────
select 'Schema setup complete' as status;
