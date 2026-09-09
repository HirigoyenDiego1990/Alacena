-- Ejecutar una sola vez en el SQL Editor de Supabase.
-- Panel privado para revisar pagos y activar Premium por 30 días.

create table if not exists public.app_admins (
    user_id uuid primary key references auth.users(id) on delete cascade,
    created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;

revoke all on public.app_admins from anon, authenticated;

create table if not exists public.premium_payment_history (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    contact_email text,
    payer_name text,
    payment_reference text,
    request_type text not null check (request_type in ('activation', 'renewal')),
    decision text not null check (decision in ('approved', 'rejected')),
    amount_ars numeric(12, 2) not null default 4500 check (amount_ars >= 0),
    payment_reported_at timestamptz,
    reviewed_at timestamptz not null default now(),
    reviewed_by uuid not null references auth.users(id),
    premium_until timestamptz
);

alter table public.premium_payment_history enable row level security;
revoke all on public.premium_payment_history from anon, authenticated;

create index if not exists premium_payment_history_reviewed_at_idx
on public.premium_payment_history (reviewed_at desc);

create index if not exists premium_payment_history_user_idx
on public.premium_payment_history (user_id, reviewed_at desc);

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

create or replace function public.list_premium_payment_history()
returns table (
    id uuid,
    user_id uuid,
    contact_email text,
    payer_name text,
    payment_reference text,
    request_type text,
    decision text,
    amount_ars numeric,
    payment_reported_at timestamptz,
    reviewed_at timestamptz,
    premium_until timestamptz
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
        history.id,
        history.user_id,
        history.contact_email,
        history.payer_name,
        history.payment_reference,
        history.request_type,
        history.decision,
        history.amount_ars,
        history.payment_reported_at,
        history.reviewed_at,
        history.premium_until
    from public.premium_payment_history as history
    order by history.reviewed_at desc;
end;
$$;

revoke all on function public.list_premium_payment_history() from public, anon, authenticated;
grant execute on function public.list_premium_payment_history() to authenticated;

create or replace function public.list_active_premium_customers()
returns table (
    user_id uuid,
    contact_email text,
    payer_name text,
    current_period_end timestamptz,
    entitlement_updated_at timestamptz,
    days_remaining integer,
    is_permanent boolean,
    approved_payments integer,
    total_paid_ars numeric,
    last_payment_at timestamptz
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
        entitlement.user_id,
        coalesce(request.contact_email, account.email)::text as contact_email,
        request.payer_name,
        entitlement.current_period_end,
        entitlement.updated_at as entitlement_updated_at,
        case
            when entitlement.current_period_end is null then null
            else greatest(
                ceil(extract(epoch from (entitlement.current_period_end - now())) / 86400.0)::integer,
                0
            )
        end as days_remaining,
        entitlement.current_period_end is null as is_permanent,
        (
            select count(*)::integer
            from public.premium_payment_history as history
            where history.user_id = entitlement.user_id
              and history.decision = 'approved'
        ) as approved_payments,
        coalesce((
            select sum(history.amount_ars)
            from public.premium_payment_history as history
            where history.user_id = entitlement.user_id
              and history.decision = 'approved'
        ), 0)::numeric as total_paid_ars,
        (
            select max(history.reviewed_at)
            from public.premium_payment_history as history
            where history.user_id = entitlement.user_id
              and history.decision = 'approved'
        ) as last_payment_at
    from public.user_entitlements as entitlement
    join auth.users as account
      on account.id = entitlement.user_id
    left join public.premium_upgrade_requests as request
      on request.user_id = entitlement.user_id
    where entitlement.plan = 'premium'
      and entitlement.status = 'active'
      and (entitlement.current_period_end is null or entitlement.current_period_end > now())
    order by entitlement.current_period_end asc nulls last, account.email asc;
end;
$$;

revoke all on function public.list_active_premium_customers() from public, anon, authenticated;
grant execute on function public.list_active_premium_customers() to authenticated;

drop function if exists public.list_premium_upgrade_requests();

create or replace function public.list_premium_upgrade_requests()
returns table (
    user_id uuid,
    contact_email text,
    payer_name text,
    payment_reference text,
    status text,
    requested_at timestamptz,
    payment_reported_at timestamptz,
    updated_at timestamptz,
    current_period_end timestamptz
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
        request.updated_at,
        entitlement.current_period_end
    from public.premium_upgrade_requests as request
    left join public.user_entitlements as entitlement
        on entitlement.user_id = request.user_id
       and entitlement.plan = 'premium'
       and entitlement.status = 'active'
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
    v_request public.premium_upgrade_requests%rowtype;
    v_status text;
    v_period_end timestamptz;
    v_previous_period_end timestamptz;
    v_request_type text;
begin
    if not public.is_app_admin() then
        raise exception 'ADMIN_REQUIRED';
    end if;

    if p_action not in ('approve', 'contact', 'reject') then
        raise exception 'INVALID_ADMIN_ACTION';
    end if;

    select *
    into v_request
    from public.premium_upgrade_requests
    where user_id = p_user_id
    for update;

    if not found then
        raise exception 'PREMIUM_REQUEST_NOT_FOUND';
    end if;

    if v_request.status not in ('pending', 'contacted') then
        raise exception 'PREMIUM_REQUEST_ALREADY_REVIEWED';
    end if;

    select current_period_end
    into v_previous_period_end
    from public.user_entitlements
    where user_id = p_user_id
      and plan = 'premium';

    v_request_type := case when v_previous_period_end is null then 'activation' else 'renewal' end;

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

    if p_action in ('approve', 'reject') then
        insert into public.premium_payment_history (
            user_id,
            contact_email,
            payer_name,
            payment_reference,
            request_type,
            decision,
            amount_ars,
            payment_reported_at,
            reviewed_by,
            premium_until
        ) values (
            p_user_id,
            v_request.contact_email,
            v_request.payer_name,
            v_request.payment_reference,
            v_request_type,
            case when p_action = 'approve' then 'approved' else 'rejected' end,
            4500,
            v_request.payment_reported_at,
            auth.uid(),
            case when p_action = 'approve' then v_period_end else null end
        );
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
