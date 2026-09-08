-- Ejecutar una sola vez en el SQL Editor de Supabase.
-- Solicitudes de acceso Premium sin pagos ni datos personales adicionales.

create table if not exists public.premium_upgrade_requests (
    user_id uuid primary key references auth.users(id) on delete cascade,
    status text not null default 'pending'
        check (status in ('pending', 'contacted', 'approved', 'rejected', 'cancelled')),
    requested_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.premium_upgrade_requests
    add column if not exists contact_email text,
    add column if not exists payer_name text,
    add column if not exists payment_reference text,
    add column if not exists payment_method text not null default 'bank_transfer',
    add column if not exists payment_reported_at timestamptz;

alter table public.premium_upgrade_requests
    drop constraint if exists premium_upgrade_requests_contact_email_length,
    add constraint premium_upgrade_requests_contact_email_length
        check (contact_email is null or char_length(contact_email) between 3 and 254),
    drop constraint if exists premium_upgrade_requests_payer_name_length,
    add constraint premium_upgrade_requests_payer_name_length
        check (payer_name is null or char_length(payer_name) between 2 and 120),
    drop constraint if exists premium_upgrade_requests_payment_reference_length,
    add constraint premium_upgrade_requests_payment_reference_length
        check (payment_reference is null or char_length(payment_reference) <= 120),
    drop constraint if exists premium_upgrade_requests_payment_method_check,
    add constraint premium_upgrade_requests_payment_method_check
        check (payment_method = 'bank_transfer');

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
begin
    if v_user_id is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if public.get_effective_plan(v_user_id) = 'premium' then
        return jsonb_build_object('status', 'already_premium');
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

    insert into public.premium_upgrade_requests (
        user_id,
        status,
        contact_email,
        payer_name,
        payment_reference,
        payment_method,
        requested_at,
        payment_reported_at,
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
        updated_at = excluded.updated_at;

    return jsonb_build_object(
        'status', 'pending',
        'payment_reported_at', now()
    );
end;
$$;

revoke all on function public.submit_premium_payment_request(text, text, text) from public, anon, authenticated;
grant execute on function public.submit_premium_payment_request(text, text, text) to authenticated;

create index if not exists premium_upgrade_requests_status_idx
on public.premium_upgrade_requests (status, requested_at);

comment on table public.premium_upgrade_requests
is 'Solicitudes de acceso Premium vinculadas solo al usuario autenticado; no procesan pagos.';
