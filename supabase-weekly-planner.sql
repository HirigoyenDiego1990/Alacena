-- Ejecutar una sola vez en el SQL Editor de Supabase.
-- Planificador semanal disponible exclusivamente para usuarios Premium.

create or replace function public.is_current_user_premium()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select auth.uid() is not null
       and public.get_effective_plan(auth.uid()) = 'premium';
$$;

revoke all on function public.is_current_user_premium() from public, anon, authenticated;
grant execute on function public.is_current_user_premium() to authenticated;

create table if not exists public.weekly_plans (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    week_start date not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, week_start)
);

create table if not exists public.weekly_plan_meals (
    id uuid primary key default gen_random_uuid(),
    plan_id uuid not null references public.weekly_plans(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    meal_date date not null,
    meal_type text not null check (meal_type in ('lunch', 'dinner')),
    saved_recipe_id text,
    recipe_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(recipe_snapshot) = 'object'),
    desired_servings integer not null default 2 check (desired_servings between 1 and 20),
    is_locked boolean not null default false,
    is_cooked boolean not null default false,
    cooked_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (plan_id, meal_date, meal_type)
);

create or replace function public.validate_weekly_plan_meal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_week_start date;
    v_plan_user_id uuid;
begin
    select week_start, user_id
    into v_week_start, v_plan_user_id
    from public.weekly_plans
    where id = new.plan_id;

    if v_week_start is null or v_plan_user_id <> new.user_id then
        raise exception 'INVALID_WEEKLY_PLAN';
    end if;

    if new.meal_date < v_week_start or new.meal_date > v_week_start + 6 then
        raise exception 'MEAL_OUTSIDE_PLAN_WEEK';
    end if;

    if new.is_cooked and new.cooked_at is null then
        new.cooked_at := now();
    elsif not new.is_cooked then
        new.cooked_at := null;
    end if;

    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists validate_weekly_plan_meal_before_write on public.weekly_plan_meals;
create trigger validate_weekly_plan_meal_before_write
before insert or update on public.weekly_plan_meals
for each row execute function public.validate_weekly_plan_meal();

create or replace function public.move_weekly_plan_meal(
    p_plan_id uuid,
    p_source_date date,
    p_source_type text,
    p_target_date date,
    p_target_type text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_source public.weekly_plan_meals%rowtype;
    v_target public.weekly_plan_meals%rowtype;
begin
    if v_user_id is null
       or public.get_effective_plan(v_user_id) <> 'premium'
       or not exists (
           select 1 from public.weekly_plans
           where id = p_plan_id and user_id = v_user_id
       ) then
        raise exception 'PREMIUM_REQUIRED';
    end if;

    select * into v_source
    from public.weekly_plan_meals
    where plan_id = p_plan_id
      and meal_date = p_source_date
      and meal_type = p_source_type
      and user_id = v_user_id
    for update;

    if v_source.id is null or v_source.is_locked then
        raise exception 'SOURCE_MEAL_NOT_MOVABLE';
    end if;

    select * into v_target
    from public.weekly_plan_meals
    where plan_id = p_plan_id
      and meal_date = p_target_date
      and meal_type = p_target_type
      and user_id = v_user_id
    for update;

    if v_target.id is not null and v_target.is_locked then
        raise exception 'TARGET_MEAL_LOCKED';
    end if;

    if v_target.id is null then
        insert into public.weekly_plan_meals (
            plan_id, user_id, meal_date, meal_type, saved_recipe_id,
            recipe_snapshot, desired_servings, is_locked, is_cooked, cooked_at
        ) values (
            p_plan_id, v_user_id, p_target_date, p_target_type, v_source.saved_recipe_id,
            v_source.recipe_snapshot, v_source.desired_servings, false, v_source.is_cooked, v_source.cooked_at
        );

        delete from public.weekly_plan_meals where id = v_source.id;
    else
        update public.weekly_plan_meals
        set saved_recipe_id = v_target.saved_recipe_id,
            recipe_snapshot = v_target.recipe_snapshot,
            desired_servings = v_target.desired_servings,
            is_locked = false,
            is_cooked = v_target.is_cooked,
            cooked_at = v_target.cooked_at
        where id = v_source.id;

        update public.weekly_plan_meals
        set saved_recipe_id = v_source.saved_recipe_id,
            recipe_snapshot = v_source.recipe_snapshot,
            desired_servings = v_source.desired_servings,
            is_locked = false,
            is_cooked = v_source.is_cooked,
            cooked_at = v_source.cooked_at
        where id = v_target.id;
    end if;

    return true;
end;
$$;

alter table public.weekly_plans enable row level security;
alter table public.weekly_plan_meals enable row level security;

drop policy if exists "premium users can read own weekly plans" on public.weekly_plans;
create policy "premium users can read own weekly plans"
on public.weekly_plans for select to authenticated
using (auth.uid() = user_id and public.is_current_user_premium());

drop policy if exists "premium users can insert own weekly plans" on public.weekly_plans;
create policy "premium users can insert own weekly plans"
on public.weekly_plans for insert to authenticated
with check (auth.uid() = user_id and public.is_current_user_premium());

drop policy if exists "premium users can update own weekly plans" on public.weekly_plans;
create policy "premium users can update own weekly plans"
on public.weekly_plans for update to authenticated
using (auth.uid() = user_id and public.is_current_user_premium())
with check (auth.uid() = user_id and public.is_current_user_premium());

drop policy if exists "premium users can delete own weekly plans" on public.weekly_plans;
create policy "premium users can delete own weekly plans"
on public.weekly_plans for delete to authenticated
using (auth.uid() = user_id and public.is_current_user_premium());

drop policy if exists "premium users can read own weekly meals" on public.weekly_plan_meals;
create policy "premium users can read own weekly meals"
on public.weekly_plan_meals for select to authenticated
using (auth.uid() = user_id and public.is_current_user_premium());

drop policy if exists "premium users can insert own weekly meals" on public.weekly_plan_meals;
create policy "premium users can insert own weekly meals"
on public.weekly_plan_meals for insert to authenticated
with check (auth.uid() = user_id and public.is_current_user_premium());

drop policy if exists "premium users can update own weekly meals" on public.weekly_plan_meals;
create policy "premium users can update own weekly meals"
on public.weekly_plan_meals for update to authenticated
using (auth.uid() = user_id and public.is_current_user_premium())
with check (auth.uid() = user_id and public.is_current_user_premium());

drop policy if exists "premium users can delete own weekly meals" on public.weekly_plan_meals;
create policy "premium users can delete own weekly meals"
on public.weekly_plan_meals for delete to authenticated
using (auth.uid() = user_id and public.is_current_user_premium());

revoke all on public.weekly_plans, public.weekly_plan_meals from anon, authenticated;
grant select, insert, update, delete on public.weekly_plans, public.weekly_plan_meals to authenticated;

revoke all on function public.validate_weekly_plan_meal() from public, anon, authenticated;
revoke all on function public.move_weekly_plan_meal(uuid, date, text, date, text) from public, anon, authenticated;
grant execute on function public.move_weekly_plan_meal(uuid, date, text, date, text) to authenticated;

create index if not exists weekly_plans_user_week_idx
on public.weekly_plans (user_id, week_start desc);

create index if not exists weekly_plan_meals_plan_date_idx
on public.weekly_plan_meals (plan_id, meal_date, meal_type);

comment on table public.weekly_plans is 'Semanas planificadas por usuarios Premium.';
comment on table public.weekly_plan_meals is 'Almuerzos y cenas con una copia estructurada de la receta.';
