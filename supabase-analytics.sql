-- Ejecutar una sola vez en el SQL Editor del proyecto de Supabase.
-- Los clientes autenticados solo pueden insertar eventos; no pueden leerlos.

create table if not exists public.analytics_events (
    id uuid primary key default gen_random_uuid(),
    anonymous_id uuid not null,
    session_id uuid not null,
    event_name text not null check (event_name in (
        'app_opened',
        'session_started',
        'ingredient_added',
        'ingredient_removed',
        'ingredient_inventory_snapshot',
        'recipe_generation_started',
        'recipe_generation_succeeded',
        'recipe_generation_failed',
        'recipe_saved',
        'recipe_opened',
        'recipe_deleted',
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
        'screen_view',
        'recipes_cleared',
        'technical_error'
    )),
    client_occurred_at timestamptz not null,
    occurred_at timestamptz not null default now(),
    properties jsonb not null default '{}'::jsonb
        check (jsonb_typeof(properties) = 'object' and octet_length(properties::text) <= 8192),
    app_version text not null default '1.0.0'
);

alter table public.analytics_events enable row level security;

drop policy if exists "authenticated users can insert analytics" on public.analytics_events;
create policy "authenticated users can insert analytics"
on public.analytics_events
for insert
to authenticated
with check (auth.uid() is not null);

revoke all on table public.analytics_events from anon, authenticated;
grant insert (anonymous_id, session_id, event_name, client_occurred_at, properties, app_version)
on table public.analytics_events to authenticated;

create index if not exists analytics_events_occurred_at_idx
on public.analytics_events (occurred_at desc);

create index if not exists analytics_events_event_name_occurred_at_idx
on public.analytics_events (event_name, occurred_at desc);

create index if not exists analytics_events_anonymous_id_occurred_at_idx
on public.analytics_events (anonymous_id, occurred_at desc);

create index if not exists analytics_events_session_id_idx
on public.analytics_events (session_id);

create or replace view public.analytics_daily_summary
with (security_invoker = true)
as
select
    (occurred_at at time zone 'America/Argentina/Buenos_Aires')::date as event_date,
    event_name,
    count(*) as event_count,
    count(distinct anonymous_id) as anonymous_users,
    count(distinct session_id) as sessions
from public.analytics_events
group by 1, 2;

revoke all on table public.analytics_daily_summary from anon, authenticated;

comment on table public.analytics_events is
'Eventos de producto seudónimos de Alacena. No contiene correos, IDs reales ni contenido de recetas.';

comment on view public.analytics_daily_summary is
'Resumen diario por evento, usuario anónimo y sesión en la zona horaria de Buenos Aires.';
