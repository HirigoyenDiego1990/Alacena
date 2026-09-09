-- Ejecutar en el SQL Editor de Supabase.
-- Historial privado de decisiones sobre pagos Premium.

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

comment on table public.premium_payment_history
is 'Historial privado e inmutable de pagos Premium revisados manualmente.';
