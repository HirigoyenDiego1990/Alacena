-- Ejecutar una sola vez en el SQL Editor de Supabase.
-- Preferencias básicas para todos y personalización avanzada para Premium.

create table if not exists public.user_recipe_preferences (
    user_id uuid primary key references auth.users(id) on delete cascade,
    diet_type text not null default 'sin_preferencia'
        check (diet_type in ('sin_preferencia', 'omnivora', 'vegetariana', 'vegana', 'sin_gluten', 'sin_lactosa')),
    avoid_ingredients text[] not null default '{}'::text[],
    default_servings integer not null default 2 check (default_servings between 1 and 20),
    max_time_minutes integer check (max_time_minutes is null or max_time_minutes between 5 and 240),
    cooking_goal text check (cooking_goal is null or cooking_goal in ('economia', 'rapidez', 'aprovechamiento', 'equilibrio')),
    equipment text[] not null default '{}'::text[],
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (cardinality(avoid_ingredients) <= 30),
    check (octet_length(array_to_string(avoid_ingredients, ',')) <= 3000),
    check (equipment <@ array['horno', 'microondas', 'air_fryer', 'licuadora', 'olla_presion', 'parrilla']::text[])
);

alter table public.user_recipe_preferences enable row level security;

drop policy if exists "users can read own recipe preferences" on public.user_recipe_preferences;
create policy "users can read own recipe preferences"
on public.user_recipe_preferences for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "users can insert own recipe preferences" on public.user_recipe_preferences;
create policy "users can insert own recipe preferences"
on public.user_recipe_preferences for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "users can update own recipe preferences" on public.user_recipe_preferences;
create policy "users can update own recipe preferences"
on public.user_recipe_preferences for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

revoke all on public.user_recipe_preferences from anon, authenticated;
grant select, insert, update on public.user_recipe_preferences to authenticated;

create or replace function public.get_my_recipe_preferences()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_plan text;
    v_preferences public.user_recipe_preferences%rowtype;
begin
    if v_user_id is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    v_plan := public.get_effective_plan(v_user_id);

    select * into v_preferences
    from public.user_recipe_preferences
    where user_id = v_user_id;

    return jsonb_build_object(
        'plan', v_plan,
        'diet_type', coalesce(v_preferences.diet_type, 'sin_preferencia'),
        'avoid_ingredients', coalesce(v_preferences.avoid_ingredients, '{}'::text[]),
        'default_servings', case when v_plan = 'premium' then coalesce(v_preferences.default_servings, 2) else 2 end,
        'max_time_minutes', case when v_plan = 'premium' then v_preferences.max_time_minutes else null end,
        'cooking_goal', case when v_plan = 'premium' then v_preferences.cooking_goal else null end,
        'equipment', case when v_plan = 'premium' then coalesce(v_preferences.equipment, '{}'::text[]) else '{}'::text[] end
    );
end;
$$;

revoke all on function public.get_my_recipe_preferences() from public, anon, authenticated;
grant execute on function public.get_my_recipe_preferences() to authenticated;

comment on table public.user_recipe_preferences is
'Preferencias culinarias privadas. No se copian a Analytics.';
