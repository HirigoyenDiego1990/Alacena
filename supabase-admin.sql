-- Ejecutar una sola vez en el SQL Editor de Supabase.
-- Panel privado para revisar pagos y activar Premium por 30 días.

create table if not exists public.app_admins (
    user_id uuid primary key references auth.users(id) on delete cascade,
    created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;

revoke all on public.app_admins from anon, authenticated;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.app_admins
        where user_id = auth.uid()
    );
$$;

revoke all on function public.is_app_admin() from public, anon, authenticated;
grant execute on function public.is_app_admin() to authenticated;

create or replace function public.list_premium_upgrade_requests()
returns table (
    user_id uuid,
    contact_email text,
    payer_name text,
    payment_reference text,
    status text,
    requested_at timestamptz,
    payment_reported_at timestamptz,
    updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.is_app_admin() then
        raise exception 'ADMIN_REQUIRED';
    end if;

    return query
    select
        request.user_id,
        request.contact_email,
        request.payer_name,
        request.payment_reference,
        request.status,
        request.requested_at,
        request.payment_reported_at,
        request.updated_at
    from public.premium_upgrade_requests as request
    order by
        case when request.status in ('pending', 'contacted') then 0 else 1 end,
        request.payment_reported_at desc nulls last,
        request.requested_at desc;
end;
$$;

revoke all on function public.list_premium_upgrade_requests() from public, anon, authenticated;
grant execute on function public.list_premium_upgrade_requests() to authenticated;

create or replace function public.review_premium_upgrade_request(
    p_user_id uuid,
    p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_status text;
    v_period_end timestamptz;
begin
    if not public.is_app_admin() then
        raise exception 'ADMIN_REQUIRED';
    end if;

    if p_action not in ('approve', 'contact', 'reject') then
        raise exception 'INVALID_ADMIN_ACTION';
    end if;

    if not exists (
        select 1
        from public.premium_upgrade_requests
        where user_id = p_user_id
    ) then
        raise exception 'PREMIUM_REQUEST_NOT_FOUND';
    end if;

    if p_action = 'approve' then
        insert into public.user_entitlements (
            user_id,
            plan,
            status,
            current_period_end,
            updated_at
        ) values (
            p_user_id,
            'premium',
            'active',
            now() + interval '30 days',
            now()
        )
        on conflict (user_id) do update
        set plan = 'premium',
            status = 'active',
            current_period_end = case
                when public.user_entitlements.plan = 'premium'
                    and public.user_entitlements.status = 'active'
                    and public.user_entitlements.current_period_end is null
                    then null
                when public.user_entitlements.current_period_end > now()
                    then public.user_entitlements.current_period_end + interval '30 days'
                else now() + interval '30 days'
            end,
            updated_at = now()
        returning current_period_end into v_period_end;

        update public.premium_upgrade_requests
        set status = 'approved', updated_at = now()
        where user_id = p_user_id
        returning status into v_status;
    elsif p_action = 'contact' then
        update public.premium_upgrade_requests
        set status = 'contacted', updated_at = now()
        where user_id = p_user_id
        returning status into v_status;
    else
        update public.premium_upgrade_requests
        set status = 'rejected', updated_at = now()
        where user_id = p_user_id
        returning status into v_status;
    end if;

    return jsonb_build_object(
        'status', v_status,
        'current_period_end', v_period_end
    );
end;
$$;

revoke all on function public.review_premium_upgrade_request(uuid, text) from public, anon, authenticated;
grant execute on function public.review_premium_upgrade_request(uuid, text) to authenticated;

comment on table public.app_admins
is 'Lista explícita de cuentas autorizadas para administrar solicitudes Premium.';

insert into public.app_admins (user_id)
select id
from auth.users
where lower(email) = lower('diegofedericohirigoyen@gmail.com')
on conflict (user_id) do nothing;

do $$
begin
    if not exists (
        select 1
        from public.app_admins as administrator
        join auth.users as account on account.id = administrator.user_id
        where lower(account.email) = lower('diegofedericohirigoyen@gmail.com')
    ) then
        raise exception 'No se encontró la cuenta administradora. Verificá que el correo ya esté registrado en Authentication.';
    end if;
end;
$$;
