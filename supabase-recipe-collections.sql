-- Ejecutar una sola vez en el SQL Editor de Supabase.
-- Colecciones personalizadas de recetas, exclusivas del plan Premium.

create table if not exists public.recipe_collections (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null check (char_length(btrim(name)) between 1 and 40),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.recipe_collection_items (
    id uuid primary key default gen_random_uuid(),
    collection_id uuid not null references public.recipe_collections(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    saved_recipe_id text not null check (char_length(saved_recipe_id) between 1 and 100),
    created_at timestamptz not null default now(),
    unique (collection_id, saved_recipe_id)
);

create unique index if not exists recipe_collections_user_name_unique_idx
on public.recipe_collections (user_id, lower(name));

create or replace function public.validate_recipe_collection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    new.name := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));

    if tg_op = 'INSERT' then
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 3));
        if (select count(*) from public.recipe_collections where user_id = new.user_id) >= 30 then
            raise exception 'COLLECTION_LIMIT_REACHED';
        end if;
    end if;

    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists validate_recipe_collection_before_write on public.recipe_collections;
create trigger validate_recipe_collection_before_write
before insert or update on public.recipe_collections
for each row execute function public.validate_recipe_collection();

create or replace function public.validate_recipe_collection_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not exists (
        select 1 from public.recipe_collections
        where id = new.collection_id and user_id = new.user_id
    ) or not exists (
        select 1 from public.saved_recipes
        where id::text = new.saved_recipe_id and user_id = new.user_id
    ) then
        raise exception 'INVALID_COLLECTION_ITEM';
    end if;

    return new;
end;
$$;

drop trigger if exists validate_recipe_collection_item_before_write on public.recipe_collection_items;
create trigger validate_recipe_collection_item_before_write
before insert or update on public.recipe_collection_items
for each row execute function public.validate_recipe_collection_item();

create or replace function public.cleanup_deleted_recipe_collections()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    delete from public.recipe_collection_items
    where user_id = old.user_id
      and saved_recipe_id = old.id::text;
    return old;
end;
$$;

drop trigger if exists cleanup_deleted_recipe_collections_after_delete on public.saved_recipes;
create trigger cleanup_deleted_recipe_collections_after_delete
after delete on public.saved_recipes
for each row execute function public.cleanup_deleted_recipe_collections();

alter table public.recipe_collections enable row level security;
alter table public.recipe_collection_items enable row level security;

drop policy if exists "premium users can read own recipe collections" on public.recipe_collections;
create policy "premium users can read own recipe collections"
on public.recipe_collections for select to authenticated
using (auth.uid() = user_id and public.is_current_user_premium());

drop policy if exists "premium users can insert own recipe collections" on public.recipe_collections;
create policy "premium users can insert own recipe collections"
on public.recipe_collections for insert to authenticated
with check (auth.uid() = user_id and public.is_current_user_premium());

drop policy if exists "premium users can update own recipe collections" on public.recipe_collections;
create policy "premium users can update own recipe collections"
on public.recipe_collections for update to authenticated
using (auth.uid() = user_id and public.is_current_user_premium())
with check (auth.uid() = user_id and public.is_current_user_premium());

drop policy if exists "premium users can delete own recipe collections" on public.recipe_collections;
create policy "premium users can delete own recipe collections"
on public.recipe_collections for delete to authenticated
using (auth.uid() = user_id and public.is_current_user_premium());

drop policy if exists "premium users can read own recipe collection items" on public.recipe_collection_items;
create policy "premium users can read own recipe collection items"
on public.recipe_collection_items for select to authenticated
using (auth.uid() = user_id and public.is_current_user_premium());

drop policy if exists "premium users can insert own recipe collection items" on public.recipe_collection_items;
create policy "premium users can insert own recipe collection items"
on public.recipe_collection_items for insert to authenticated
with check (auth.uid() = user_id and public.is_current_user_premium());

drop policy if exists "premium users can delete own recipe collection items" on public.recipe_collection_items;
create policy "premium users can delete own recipe collection items"
on public.recipe_collection_items for delete to authenticated
using (auth.uid() = user_id and public.is_current_user_premium());

revoke all on public.recipe_collections, public.recipe_collection_items from anon, authenticated;
grant select, insert, update, delete on public.recipe_collections to authenticated;
grant select, insert, delete on public.recipe_collection_items to authenticated;

revoke all on function public.validate_recipe_collection() from public, anon, authenticated;
revoke all on function public.validate_recipe_collection_item() from public, anon, authenticated;
revoke all on function public.cleanup_deleted_recipe_collections() from public, anon, authenticated;

create index if not exists recipe_collection_items_user_recipe_idx
on public.recipe_collection_items (user_id, saved_recipe_id);

comment on table public.recipe_collections is 'Colecciones Premium para organizar recetas favoritas.';
comment on table public.recipe_collection_items is 'Relación de una receta con una o varias colecciones.';
