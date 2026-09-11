-- Ejecutar una sola vez en el SQL Editor de Supabase.
-- Implementa planes, límites diarios y reservas atómicas de generación.

create table if not exists public.user_entitlements (
    user_id uuid primary key references auth.users(id) on delete cascade,
    plan text not null default 'free' check (plan in ('free', 'premium')),
    status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
    current_period_end timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.daily_usage (
    user_id uuid not null references auth.users(id) on delete cascade,
    usage_date date not null default current_date,
    metric text not null check (metric in ('recipe_generation')),
    usage_count integer not null default 0 check (usage_count >= 0),
    updated_at timestamptz not null default now(),
    primary key (user_id, usage_date, metric)
);

create table if not exists public.generation_reservations (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    usage_date date not null default current_date,
    status text not null default 'reserved' check (status in ('reserved', 'completed', 'released')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.user_entitlements enable row level security;
alter table public.daily_usage enable row level security;
alter table public.generation_reservations enable row level security;

drop policy if exists "users can read own entitlement" on public.user_entitlements;
create policy "users can read own entitlement"
on public.user_entitlements for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "users can read own usage" on public.daily_usage;
create policy "users can read own usage"
on public.daily_usage for select to authenticated
using (auth.uid() = user_id);

revoke all on public.user_entitlements from anon, authenticated;
revoke all on public.daily_usage from anon, authenticated;
revoke all on public.generation_reservations from anon, authenticated;
grant select on public.user_entitlements, public.daily_usage to authenticated;

create or replace function public.get_effective_plan(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select case
        when exists (
            select 1
            from public.user_entitlements
            where user_id = p_user_id
              and plan = 'premium'
              and status = 'active'
              and (current_period_end is null or current_period_end > now())
        ) then 'premium'
        else 'free'
    end;
$$;

create or replace function public.get_my_plan_limits()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_plan text;
    v_generation_limit integer;
    v_generation_used integer;
    v_current_period_end timestamptz;
    v_usage_date date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
    if v_user_id is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    v_plan := public.get_effective_plan(v_user_id);
    v_generation_limit := 3;

    -- Conservamos la última fecha aunque ya haya vencido para poder mostrar
    -- el aviso de renovación en la cuenta que volvió automáticamente a Free.
    select current_period_end
    into v_current_period_end
    from public.user_entitlements
    where user_id = v_user_id
      and plan = 'premium'
      and status = 'active';

    select coalesce(usage_count, 0)
    into v_generation_used
    from public.daily_usage
    where user_id = v_user_id
      and usage_date = v_usage_date
      and metric = 'recipe_generation';

    v_generation_used := least(coalesce(v_generation_used, 0), v_generation_limit);

    return jsonb_build_object(
        'plan', v_plan,
        'current_period_end', v_current_period_end,
        'generation_limit', v_generation_limit,
        'generation_used', v_generation_used,
        'generation_remaining', greatest(v_generation_limit - v_generation_used, 0),
        'pantry_limit', case when v_plan = 'premium' then null else 20 end,
        'saved_recipe_limit', case when v_plan = 'premium' then null else 10 end,
        'alacena_results', case when v_plan = 'premium' then 7 else 2 end,
        'suggestion_results', case when v_plan = 'premium' then 3 else 1 end
    );
end;
$$;

create or replace function public.reserve_recipe_generation()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_plan text;
    v_limit integer;
    v_used integer;
    v_reservation_id uuid;
    v_usage_date date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
    if v_user_id is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    v_plan := public.get_effective_plan(v_user_id);
    v_limit := 3;

    -- Recupera automáticamente reservas abandonadas por una caída del servidor.
    with released as (
        update public.generation_reservations
        set status = 'released', updated_at = now()
        where user_id = v_user_id
          and status = 'reserved'
          and created_at < now() - interval '15 minutes'
        returning usage_date
    ), released_counts as (
        select usage_date, count(*)::integer as released_count
        from released
        group by usage_date
    )
    update public.daily_usage as usage
    set usage_count = greatest(usage.usage_count - released_counts.released_count, 0),
        updated_at = now()
    from released_counts
    where usage.user_id = v_user_id
      and usage.usage_date = released_counts.usage_date
      and usage.metric = 'recipe_generation';

    insert into public.daily_usage (user_id, usage_date, metric, usage_count)
    values (v_user_id, v_usage_date, 'recipe_generation', 1)
    on conflict (user_id, usage_date, metric)
    do update set
        usage_count = public.daily_usage.usage_count + 1,
        updated_at = now()
    where public.daily_usage.usage_count < v_limit
    returning usage_count into v_used;

    if v_used is null then
        select usage_count into v_used
        from public.daily_usage
        where user_id = v_user_id
          and usage_date = v_usage_date
          and metric = 'recipe_generation';

        return jsonb_build_object(
            'allowed', false,
            'plan', v_plan,
            'generation_limit', v_limit,
            'generation_used', least(coalesce(v_used, v_limit), v_limit),
            'generation_remaining', 0,
            'alacena_results', case when v_plan = 'premium' then 7 else 2 end,
            'suggestion_results', case when v_plan = 'premium' then 3 else 1 end
        );
    end if;

    insert into public.generation_reservations (user_id, usage_date)
    values (v_user_id, v_usage_date)
    returning id into v_reservation_id;

    return jsonb_build_object(
        'allowed', true,
        'reservation_id', v_reservation_id,
        'plan', v_plan,
        'generation_limit', v_limit,
        'generation_used', v_used,
        'generation_remaining', greatest(v_limit - v_used, 0),
        'alacena_results', case when v_plan = 'premium' then 7 else 2 end,
        'suggestion_results', case when v_plan = 'premium' then 3 else 1 end
    );
end;
$$;

create or replace function public.complete_recipe_generation(p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.generation_reservations
    set status = 'completed', updated_at = now()
    where id = p_reservation_id
      and user_id = auth.uid()
      and status = 'reserved';

    return found;
end;
$$;

create or replace function public.release_recipe_generation(p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_usage_date date;
begin
    update public.generation_reservations
    set status = 'released', updated_at = now()
    where id = p_reservation_id
      and user_id = auth.uid()
      and status = 'reserved'
    returning usage_date into v_usage_date;

    if v_usage_date is null then
        return false;
    end if;

    update public.daily_usage
    set usage_count = greatest(usage_count - 1, 0), updated_at = now()
    where user_id = auth.uid()
      and usage_date = v_usage_date
      and metric = 'recipe_generation';

    return true;
end;
$$;

create or replace function public.enforce_free_pantry_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 0));

    if public.get_effective_plan(new.user_id) = 'free'
       and (select count(*) from public.pantry where user_id = new.user_id) >= 20 then
        raise exception 'FREE_PANTRY_LIMIT';
    end if;
    return new;
end;
$$;

drop trigger if exists enforce_free_pantry_limit_before_insert on public.pantry;
create trigger enforce_free_pantry_limit_before_insert
before insert on public.pantry
for each row execute function public.enforce_free_pantry_limit();

create or replace function public.enforce_free_saved_recipe_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 1));

    if public.get_effective_plan(new.user_id) = 'free'
       and (select count(*) from public.saved_recipes where user_id = new.user_id) >= 10 then
        raise exception 'FREE_SAVED_RECIPE_LIMIT';
    end if;
    return new;
end;
$$;

drop trigger if exists enforce_free_saved_recipe_limit_before_insert on public.saved_recipes;
create trigger enforce_free_saved_recipe_limit_before_insert
before insert on public.saved_recipes
for each row execute function public.enforce_free_saved_recipe_limit();

revoke all on function public.get_effective_plan(uuid) from public, anon, authenticated;
revoke all on function public.get_my_plan_limits() from public, anon, authenticated;
revoke all on function public.reserve_recipe_generation() from public, anon, authenticated;
revoke all on function public.complete_recipe_generation(uuid) from public, anon, authenticated;
revoke all on function public.release_recipe_generation(uuid) from public, anon, authenticated;
revoke all on function public.enforce_free_pantry_limit() from public, anon, authenticated;
revoke all on function public.enforce_free_saved_recipe_limit() from public, anon, authenticated;

grant execute on function public.get_my_plan_limits() to authenticated;
grant execute on function public.reserve_recipe_generation() to authenticated;
grant execute on function public.complete_recipe_generation(uuid) to authenticated;
grant execute on function public.release_recipe_generation(uuid) to authenticated;

-- Para convertir manualmente un usuario a Premium durante las pruebas:
-- insert into public.user_entitlements (user_id, plan, status)
-- values ('UUID_DEL_USUARIO', 'premium', 'active')
-- on conflict (user_id) do update
-- set plan = 'premium', status = 'active', updated_at = now();
