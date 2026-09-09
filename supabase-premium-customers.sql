-- Ejecutar en el SQL Editor de Supabase.
-- Vista administrativa segura de clientes Premium activos.

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
