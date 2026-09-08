-- Ejecutar una sola vez en el SQL Editor de Supabase.
-- Lista de compras consolidada, disponible exclusivamente para usuarios Premium.

create table if not exists public.shopping_lists (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    weekly_plan_id uuid not null references public.weekly_plans(id) on delete cascade,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, weekly_plan_id)
);

create table if not exists public.shopping_list_items (
    id uuid primary key default gen_random_uuid(),
    list_id uuid not null references public.shopping_lists(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    source_type text not null check (source_type in ('plan', 'manual')),
    source_key text not null check (char_length(source_key) between 1 and 160),
    name text not null check (char_length(btrim(name)) between 1 and 100),
    quantity numeric(12, 2) not null check (quantity > 0 and quantity <= 99999),
    unit text not null check (char_length(btrim(unit)) between 1 and 30),
    is_checked boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (list_id, source_type, source_key)
);

create or replace function public.validate_shopping_list_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_list_user_id uuid;
begin
    select user_id into v_list_user_id
    from public.shopping_lists
    where id = new.list_id;

    if v_list_user_id is null or v_list_user_id <> new.user_id then
        raise exception 'INVALID_SHOPPING_LIST';
    end if;

    new.name := btrim(new.name);
    new.unit := lower(btrim(new.unit));
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists validate_shopping_list_item_before_write on public.shopping_list_items;
create trigger validate_shopping_list_item_before_write
before insert or update on public.shopping_list_items
for each row execute function public.validate_shopping_list_item();

alter table public.shopping_lists enable row level security;
alter table public.shopping_list_items enable row level security;

drop policy if exists "premium users can read own shopping lists" on public.shopping_lists;
create policy "premium users can read own shopping lists"
on public.shopping_lists for select to authenticated
using (auth.uid() = user_id and public.is_current_user_premium());

drop policy if exists "premium users can insert own shopping lists" on public.shopping_lists;
create policy "premium users can insert own shopping lists"
on public.shopping_lists for insert to authenticated
with check (
    auth.uid() = user_id
    and public.is_current_user_premium()
    and exists (
        select 1 from public.weekly_plans
        where id = weekly_plan_id and user_id = auth.uid()
    )
);

drop policy if exists "premium users can update own shopping lists" on public.shopping_lists;
create policy "premium users can update own shopping lists"
on public.shopping_lists for update to authenticated
using (auth.uid() = user_id and public.is_current_user_premium())
with check (
    auth.uid() = user_id
    and public.is_current_user_premium()
    and exists (
        select 1 from public.weekly_plans
        where id = weekly_plan_id and user_id = auth.uid()
    )
);

drop policy if exists "premium users can delete own shopping lists" on public.shopping_lists;
create policy "premium users can delete own shopping lists"
on public.shopping_lists for delete to authenticated
using (auth.uid() = user_id and public.is_current_user_premium());

drop policy if exists "premium users can read own shopping items" on public.shopping_list_items;
create policy "premium users can read own shopping items"
on public.shopping_list_items for select to authenticated
using (auth.uid() = user_id and public.is_current_user_premium());

drop policy if exists "premium users can insert own shopping items" on public.shopping_list_items;
create policy "premium users can insert own shopping items"
on public.shopping_list_items for insert to authenticated
with check (
    auth.uid() = user_id
    and public.is_current_user_premium()
    and exists (
        select 1 from public.shopping_lists
        where id = list_id and user_id = auth.uid()
    )
);

drop policy if exists "premium users can update own shopping items" on public.shopping_list_items;
create policy "premium users can update own shopping items"
on public.shopping_list_items for update to authenticated
using (auth.uid() = user_id and public.is_current_user_premium())
with check (
    auth.uid() = user_id
    and public.is_current_user_premium()
    and exists (
        select 1 from public.shopping_lists
        where id = list_id and user_id = auth.uid()
    )
);

drop policy if exists "premium users can delete own shopping items" on public.shopping_list_items;
create policy "premium users can delete own shopping items"
on public.shopping_list_items for delete to authenticated
using (auth.uid() = user_id and public.is_current_user_premium());

revoke all on public.shopping_lists, public.shopping_list_items from anon, authenticated;
grant select, insert, update, delete on public.shopping_lists, public.shopping_list_items to authenticated;

revoke all on function public.validate_shopping_list_item() from public, anon, authenticated;

create index if not exists shopping_lists_user_plan_idx
on public.shopping_lists (user_id, weekly_plan_id);

create index if not exists shopping_list_items_list_status_idx
on public.shopping_list_items (list_id, is_checked, name);

comment on table public.shopping_lists is 'Listas Premium asociadas a una semana planificada.';
comment on table public.shopping_list_items is 'Productos consolidados desde el plan o agregados manualmente.';
