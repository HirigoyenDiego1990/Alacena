-- Ejecutar en el SQL Editor de Supabase.
-- Actualización incremental: aviso único por correo para pagos Premium.

alter table public.premium_upgrade_requests
    add column if not exists notification_sent_at timestamptz;

create or replace function public.submit_premium_payment_request(
    p_contact_email text,
    p_payer_name text,
    p_payment_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_email text := lower(trim(p_contact_email));
    v_account_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
    v_payer_name text := trim(p_payer_name);
    v_reference text := nullif(trim(p_payment_reference), '');
    v_entitlement_plan text;
    v_entitlement_status text;
    v_period_end timestamptz;
    v_existing_status text;
    v_existing_reported_at timestamptz;
begin
    if v_user_id is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    select plan, status, current_period_end
    into v_entitlement_plan, v_entitlement_status, v_period_end
    from public.user_entitlements
    where user_id = v_user_id;

    if v_entitlement_plan = 'premium'
        and v_entitlement_status = 'active'
        and v_period_end is null then
        return jsonb_build_object('status', 'already_premium');
    end if;

    if public.get_effective_plan(v_user_id) = 'premium'
        and v_period_end > now() + interval '7 days' then
        return jsonb_build_object(
            'status', 'renewal_not_available',
            'current_period_end', v_period_end
        );
    end if;

    if char_length(v_email) not between 3 and 254 or position('@' in v_email) <= 1 then
        raise exception 'INVALID_CONTACT_EMAIL';
    end if;

    if v_email <> v_account_email then
        raise exception 'CONTACT_EMAIL_MUST_MATCH_ACCOUNT';
    end if;

    if char_length(v_payer_name) not between 2 and 120 then
        raise exception 'INVALID_PAYER_NAME';
    end if;

    if v_reference is not null and char_length(v_reference) > 120 then
        raise exception 'INVALID_PAYMENT_REFERENCE';
    end if;

    select status, payment_reported_at
    into v_existing_status, v_existing_reported_at
    from public.premium_upgrade_requests
    where user_id = v_user_id;

    if v_existing_status in ('pending', 'contacted') and v_existing_reported_at is not null then
        return jsonb_build_object(
            'status', 'already_pending',
            'payment_reported_at', v_existing_reported_at
        );
    end if;

    insert into public.premium_upgrade_requests (
        user_id,
        status,
        contact_email,
        payer_name,
        payment_reference,
        payment_method,
        requested_at,
        payment_reported_at,
        notification_sent_at,
        updated_at
    ) values (
        v_user_id,
        'pending',
        v_email,
        v_payer_name,
        v_reference,
        'bank_transfer',
        now(),
        now(),
        null,
        now()
    )
    on conflict (user_id) do update
    set status = 'pending',
        contact_email = excluded.contact_email,
        payer_name = excluded.payer_name,
        payment_reference = excluded.payment_reference,
        payment_method = excluded.payment_method,
        requested_at = excluded.requested_at,
        payment_reported_at = excluded.payment_reported_at,
        notification_sent_at = null,
        updated_at = excluded.updated_at;

    return jsonb_build_object(
        'status', 'pending',
        'payment_reported_at', now()
    );
end;
$$;

revoke all on function public.submit_premium_payment_request(text, text, text) from public, anon, authenticated;
grant execute on function public.submit_premium_payment_request(text, text, text) to authenticated;

create or replace function public.claim_premium_payment_notification()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_request public.premium_upgrade_requests%rowtype;
    v_period_end timestamptz;
begin
    if v_user_id is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    update public.premium_upgrade_requests
    set notification_sent_at = now()
    where user_id = v_user_id
      and status in ('pending', 'contacted')
      and payment_reported_at is not null
      and (notification_sent_at is null or notification_sent_at < payment_reported_at)
    returning * into v_request;

    if not found then
        return jsonb_build_object('status', 'already_notified');
    end if;

    select current_period_end
    into v_period_end
    from public.user_entitlements
    where user_id = v_user_id
      and plan = 'premium';

    return jsonb_build_object(
        'status', 'claimed',
        'user_id', v_request.user_id,
        'contact_email', v_request.contact_email,
        'payer_name', v_request.payer_name,
        'payment_reference', v_request.payment_reference,
        'payment_reported_at', v_request.payment_reported_at,
        'request_type', case when v_period_end is null then 'activation' else 'renewal' end
    );
end;
$$;

revoke all on function public.claim_premium_payment_notification() from public, anon, authenticated;
grant execute on function public.claim_premium_payment_notification() to authenticated;
