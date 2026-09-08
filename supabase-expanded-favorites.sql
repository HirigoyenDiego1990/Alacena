-- Ejecutar una sola vez en el SQL Editor de Supabase.
-- Favoritos ampliados e historial cronológico para Premium.

alter table public.saved_recipes
    add column if not exists created_at timestamptz not null default now(),
    add column if not exists updated_at timestamptz not null default now(),
    add column if not exists is_pinned boolean not null default false,
    add column if not exists rating smallint,
    add column if not exists personal_note text,
    add column if not exists last_cooked_at timestamptz;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'saved_recipes_rating_valid'
          and conrelid = 'public.saved_recipes'::regclass
    ) then
        alter table public.saved_recipes
            add constraint saved_recipes_rating_valid
            check (rating is null or rating between 1 and 5);
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'saved_recipes_personal_note_length'
          and conrelid = 'public.saved_recipes'::regclass
    ) then
        alter table public.saved_recipes
            add constraint saved_recipes_personal_note_length
            check (personal_note is null or char_length(personal_note) <= 500);
    end if;
end;
$$;

create table if not exists public.recipe_cooking_history (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    saved_recipe_id text not null,
    recipe_title text not null check (char_length(recipe_title) between 1 and 200),
    source text not null default 'favorites' check (source in ('favorites', 'weekly_plan')),
    cooked_at timestamptz not null default now()
);

create or replace function public.enforce_premium_saved_recipe_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if public.get_effective_plan(new.user_id) = 'free'
       and (
           new.is_pinned is distinct from old.is_pinned
           or new.rating is distinct from old.rating
           or new.personal_note is distinct from old.personal_note
       ) then
        raise exception 'PREMIUM_REQUIRED';
    end if;

    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists enforce_premium_saved_recipe_metadata_before_update on public.saved_recipes;
create trigger enforce_premium_saved_recipe_metadata_before_update
before update on public.saved_recipes
for each row execute function public.enforce_premium_saved_recipe_metadata();

create or replace function public.record_recipe_cooked(
    p_recipe_id text,
    p_source text default 'favorites'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_recipe_title text;
    v_times_cooked integer;
begin
    if v_user_id is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if p_source not in ('favorites', 'weekly_plan') then
        raise exception 'INVALID_COOKING_SOURCE';
    end if;

    update public.saved_recipes
    set times_cooked = coalesce(times_cooked, 0) + 1,
        last_cooked_at = now(),
        updated_at = now()
    where id::text = p_recipe_id
      and user_id = v_user_id
    returning title, times_cooked into v_recipe_title, v_times_cooked;

    if v_recipe_title is null then
        raise exception 'RECIPE_NOT_FOUND';
    end if;

    insert into public.recipe_cooking_history (
        user_id, saved_recipe_id, recipe_title, source
    ) values (
        v_user_id, p_recipe_id, left(v_recipe_title, 200), p_source
    );

    return jsonb_build_object(
        'times_cooked', v_times_cooked,
        'recorded_at', now()
    );
end;
$$;

alter table public.recipe_cooking_history enable row level security;

drop policy if exists "premium users can read own cooking history" on public.recipe_cooking_history;
create policy "premium users can read own cooking history"
on public.recipe_cooking_history for select to authenticated
using (auth.uid() = user_id and public.is_current_user_premium());

revoke all on public.recipe_cooking_history from anon, authenticated;
grant select on public.recipe_cooking_history to authenticated;

revoke all on function public.enforce_premium_saved_recipe_metadata() from public, anon, authenticated;
revoke all on function public.record_recipe_cooked(text, text) from public, anon, authenticated;
grant execute on function public.record_recipe_cooked(text, text) to authenticated;

create index if not exists saved_recipes_user_pinned_idx
on public.saved_recipes (user_id, is_pinned desc, created_at desc);

create index if not exists cooking_history_user_date_idx
on public.recipe_cooking_history (user_id, cooked_at desc);

comment on column public.saved_recipes.is_pinned is 'Destaca una favorita Premium al comienzo de la biblioteca.';
comment on column public.saved_recipes.rating is 'Valoración privada del usuario entre una y cinco estrellas.';
comment on column public.saved_recipes.personal_note is 'Nota privada Premium; nunca se envía a Analytics.';
comment on table public.recipe_cooking_history is 'Historial cronológico de recetas marcadas como cocinadas.';
