-- Ejecutar una sola vez en el SQL Editor de Supabase.
-- Solicitudes de acceso Premium sin pagos ni datos personales adicionales.

create table if not exists public.premium_upgrade_requests (
    user_id uuid primary key references auth.users(id) on delete cascade,
    status text not null default 'pending'
        check (status in ('pending', 'contacted', 'approved', 'rejected', 'cancelled')),
    requested_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.premium_upgrade_requests enable row level security;

drop policy if exists "users can read own premium request" on public.premium_upgrade_requests;
create policy "users can read own premium request"
on public.premium_upgrade_requests for select to authenticated
using (auth.uid() = user_id);

revoke all on public.premium_upgrade_requests from anon, authenticated;
grant select on public.premium_upgrade_requests to authenticated;

create or replace function public.request_premium_upgrade()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_status text;
    v_requested_at timestamptz;
begin
    if v_user_id is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if public.get_effective_plan(v_user_id) = 'premium' then
        return jsonb_build_object('status', 'already_premium');
    end if;

    insert into public.premium_upgrade_requests (user_id, status)
    values (v_user_id, 'pending')
    on conflict (user_id) do update
    set status = case
            when public.premium_upgrade_requests.status in ('approved', 'contacted')
                then public.premium_upgrade_requests.status
            else 'pending'
        end,
        requested_at = case
            when public.premium_upgrade_requests.status in ('rejected', 'cancelled')
                then now()
            else public.premium_upgrade_requests.requested_at
        end,
        updated_at = now()
    returning status, requested_at into v_status, v_requested_at;

    return jsonb_build_object(
        'status', v_status,
        'requested_at', v_requested_at
    );
end;
$$;

revoke all on function public.request_premium_upgrade() from public, anon, authenticated;
grant execute on function public.request_premium_upgrade() to authenticated;

create index if not exists premium_upgrade_requests_status_idx
on public.premium_upgrade_requests (status, requested_at);

comment on table public.premium_upgrade_requests
is 'Solicitudes de acceso Premium vinculadas solo al usuario autenticado; no procesan pagos.';
