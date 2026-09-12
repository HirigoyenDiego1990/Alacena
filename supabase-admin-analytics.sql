-- Ejecutar una sola vez en el SQL Editor de Supabase.
-- Corrige la admisión de eventos nuevos y crea el resumen privado de Analytics.

alter table public.analytics_events
drop constraint if exists analytics_events_event_name_check;

alter table public.analytics_events
add constraint analytics_events_event_name_check
check (event_name ~ '^[a-z][a-z0-9_]{1,79}$');

create or replace function public.get_admin_analytics(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_days integer;
    v_start_at timestamptz;
    v_result jsonb;
begin
    if not public.is_app_admin() then
        raise exception 'ADMIN_REQUIRED';
    end if;

    v_days := case when p_days in (7, 30, 90) then p_days else 30 end;
    v_start_at := (
        ((now() at time zone 'America/Argentina/Buenos_Aires')::date - (v_days - 1))::timestamp
        at time zone 'America/Argentina/Buenos_Aires'
    );

    with filtered as materialized (
        select
            event.anonymous_id,
            event.session_id,
            event.event_name,
            event.occurred_at,
            event.properties
        from public.analytics_events as event
        where event.occurred_at >= v_start_at
    ),
    calendar_days as (
        select (
            (now() at time zone 'America/Argentina/Buenos_Aires')::date - series.day_offset
        )::date as event_date
        from generate_series(v_days - 1, 0, -1) as series(day_offset)
    ),
    daily_totals as (
        select
            (event.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date as event_date,
            count(distinct event.anonymous_id) as anonymous_users,
            count(distinct event.session_id) as sessions,
            count(*) filter (where event.event_name = 'app_opened') as app_opens,
            coalesce(sum(
                case
                    when event.event_name = 'recipe_generation_succeeded'
                     and (event.properties ->> 'result_count') ~ '^[0-9]+$'
                        then (event.properties ->> 'result_count')::integer
                    else 0
                end
            ), 0) as recipes_generated
        from filtered as event
        group by 1
    )
    select jsonb_build_object(
        'period_days', v_days,
        'generated_at', now(),
        'summary', (
            select jsonb_build_object(
                'anonymous_users', count(distinct event.anonymous_id),
                'sessions', count(distinct event.session_id),
                'app_opens', count(*) filter (where event.event_name = 'app_opened'),
                'recipes_generated', coalesce(sum(
                    case
                        when event.event_name = 'recipe_generation_succeeded'
                         and (event.properties ->> 'result_count') ~ '^[0-9]+$'
                            then (event.properties ->> 'result_count')::integer
                        else 0
                    end
                ), 0),
                'generation_errors', count(*) filter (where event.event_name = 'recipe_generation_failed'),
                'technical_errors', count(*) filter (where event.event_name = 'technical_error'),
                'ingredients_added', coalesce(sum(
                    case
                        when event.event_name = 'ingredients_bulk_added'
                         and (event.properties ->> 'added_count') ~ '^[0-9]+$'
                            then (event.properties ->> 'added_count')::integer
                        else 0
                    end
                ), 0),
                'ingredients_removed', count(*) filter (where event.event_name = 'ingredient_removed'),
                'average_pantry_items', coalesce(round(avg(
                    case
                        when event.event_name = 'ingredient_inventory_snapshot'
                         and (event.properties ->> 'ingredient_count') ~ '^[0-9]+$'
                            then (event.properties ->> 'ingredient_count')::integer
                        else null
                    end
                ), 1), 0)
            )
            from filtered as event
        ),
        'daily', (
            select coalesce(jsonb_agg(
                jsonb_build_object(
                    'event_date', day.event_date,
                    'anonymous_users', coalesce(total.anonymous_users, 0),
                    'sessions', coalesce(total.sessions, 0),
                    'app_opens', coalesce(total.app_opens, 0),
                    'recipes_generated', coalesce(total.recipes_generated, 0)
                ) order by day.event_date
            ), '[]'::jsonb)
            from calendar_days as day
            left join daily_totals as total using (event_date)
        ),
        'screens', (
            select coalesce(jsonb_agg(to_jsonb(screen_stats) order by screen_stats.event_count desc), '[]'::jsonb)
            from (
                select
                    coalesce(nullif(event.properties ->> 'screen', ''), 'sin_identificar') as screen,
                    count(*) as event_count,
                    count(distinct event.anonymous_id) as anonymous_users
                from filtered as event
                where event.event_name = 'screen_view'
                  and coalesce(event.properties ->> 'screen', '') not like 'admin_%'
                group by 1
                order by event_count desc
                limit 8
            ) as screen_stats
        ),
        'actions', (
            select coalesce(jsonb_agg(to_jsonb(action_stats) order by action_stats.event_count desc), '[]'::jsonb)
            from (
                select event.event_name, count(*) as event_count
                from filtered as event
                where event.event_name in (
                    'ingredients_bulk_added',
                    'ingredient_removed',
                    'recipe_generation_succeeded',
                    'recipe_generation_failed',
                    'recipe_saved',
                    'recipe_opened',
                    'recipe_marked_cooked',
                    'cooking_started',
                    'cooking_step_completed',
                    'cooking_finished',
                    'timer_configured',
                    'timer_started',
                    'timer_paused',
                    'timer_reset',
                    'timer_finished',
                    'survival_roulette_used',
                    'shopping_list_opened',
                    'shopping_list_synced',
                    'shopping_manual_item_added',
                    'shopping_item_checked',
                    'shopping_item_cost_updated',
                    'shopping_list_shared',
                    'weekly_budget_updated'
                )
                group by event.event_name
                order by event_count desc
                limit 12
            ) as action_stats
        ),
        'plans', (
            select coalesce(jsonb_agg(to_jsonb(plan_stats) order by plan_stats.plan_tier), '[]'::jsonb)
            from (
                select
                    case when event.properties ->> 'plan_tier' = 'premium' then 'premium' else 'free' end as plan_tier,
                    count(distinct event.anonymous_id) as anonymous_users,
                    count(distinct event.session_id) as sessions,
                    count(*) as events
                from filtered as event
                group by 1
            ) as plan_stats
        ),
        'errors', (
            select coalesce(jsonb_agg(to_jsonb(error_stats) order by error_stats.event_count desc), '[]'::jsonb)
            from (
                select
                    coalesce(nullif(event.properties ->> 'context', ''), 'sin_contexto') as context,
                    coalesce(nullif(event.properties ->> 'error_type', ''), 'Error') as error_type,
                    count(*) as event_count,
                    max(event.occurred_at) as last_seen_at
                from filtered as event
                where event.event_name = 'technical_error'
                group by 1, 2
                order by event_count desc
                limit 8
            ) as error_stats
        )
    ) into v_result;

    return v_result;
end;
$$;

revoke all on function public.get_admin_analytics(integer) from public, anon, authenticated;
grant execute on function public.get_admin_analytics(integer) to authenticated;

comment on function public.get_admin_analytics(integer)
is 'Entrega métricas anónimas agregadas únicamente a administradores de Alacena.';
