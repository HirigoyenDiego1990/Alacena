-- Ajusta el límite diario a 3 generaciones para Free y Premium.
-- Free recibe hasta 9 recetas por día; Premium, hasta 30.
-- Ejecutar una sola vez en Supabase SQL Editor.

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
    v_generation_limit integer := 3;
    v_generation_used integer;
    v_current_period_end timestamptz;
    v_usage_date date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
    if v_user_id is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    v_plan := public.get_effective_plan(v_user_id);

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
    v_limit integer := 3;
    v_used integer;
    v_reservation_id uuid;
    v_usage_date date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
    if v_user_id is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    v_plan := public.get_effective_plan(v_user_id);

    -- Recupera reservas abandonadas por una caída del servidor.
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

revoke all on function public.get_my_plan_limits() from public, anon, authenticated;
revoke all on function public.reserve_recipe_generation() from public, anon, authenticated;

grant execute on function public.get_my_plan_limits() to authenticated;
grant execute on function public.reserve_recipe_generation() to authenticated;
