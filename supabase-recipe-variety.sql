-- Memoria de variedad para evitar recetas repetidas entre generaciones.
-- Ejecutar una sola vez en Supabase SQL Editor.

create table if not exists public.recipe_generation_history (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    title text not null check (char_length(btrim(title)) between 1 and 160),
    recipe_fingerprint text not null check (recipe_fingerprint ~ '^[a-f0-9]{64}$'),
    input_ingredients text[] not null default '{}'::text[],
    generated_at timestamptz not null default now(),
    unique (user_id, recipe_fingerprint),
    check (cardinality(input_ingredients) between 1 and 100),
    check (octet_length(array_to_string(input_ingredients, ',')) <= 10000)
);

alter table public.recipe_generation_history enable row level security;

revoke all on public.recipe_generation_history from anon, authenticated;

create index if not exists recipe_generation_history_user_recent_idx
on public.recipe_generation_history (user_id, generated_at desc);

create or replace function public.get_recent_recipe_history(p_limit integer default 120)
returns table (title text, input_ingredients text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_limit integer := greatest(1, least(coalesce(p_limit, 120), 200));
begin
    if v_user_id is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    return query
    select history.title, history.input_ingredients
    from public.recipe_generation_history as history
    where history.user_id = v_user_id
    order by history.generated_at desc
    limit v_limit;
end;
$$;

create or replace function public.record_recipe_generation_history(p_recipes jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_recipe jsonb;
    v_title text;
    v_fingerprint text;
    v_input_ingredients text[];
    v_recorded integer := 0;
begin
    if v_user_id is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if jsonb_typeof(p_recipes) <> 'array'
       or jsonb_array_length(p_recipes) not between 1 and 10 then
        raise exception 'INVALID_RECIPE_HISTORY';
    end if;

    for v_recipe in select value from jsonb_array_elements(p_recipes)
    loop
        v_title := left(btrim(v_recipe->>'title'), 160);
        v_fingerprint := lower(v_recipe->>'fingerprint');
        v_input_ingredients := array(
            select left(btrim(value), 100)
            from jsonb_array_elements_text(coalesce(v_recipe->'input_ingredients', '[]'::jsonb))
            where btrim(value) <> ''
            limit 100
        );

        if char_length(v_title) between 1 and 160
           and v_fingerprint ~ '^[a-f0-9]{64}$'
           and cardinality(v_input_ingredients) between 1 and 100 then
            insert into public.recipe_generation_history (
                user_id,
                title,
                recipe_fingerprint,
                input_ingredients,
                generated_at
            )
            values (
                v_user_id,
                v_title,
                v_fingerprint,
                v_input_ingredients,
                now()
            )
            on conflict (user_id, recipe_fingerprint)
            do update set
                title = excluded.title,
                input_ingredients = excluded.input_ingredients,
                generated_at = excluded.generated_at;

            v_recorded := v_recorded + 1;
        end if;
    end loop;

    delete from public.recipe_generation_history
    where user_id = v_user_id
      and id in (
          select old_history.id
          from public.recipe_generation_history as old_history
          where old_history.user_id = v_user_id
          order by old_history.generated_at desc
          offset 200
      );

    return v_recorded;
end;
$$;

revoke all on function public.get_recent_recipe_history(integer) from public, anon, authenticated;
revoke all on function public.record_recipe_generation_history(jsonb) from public, anon, authenticated;

grant execute on function public.get_recent_recipe_history(integer) to authenticated;
grant execute on function public.record_recipe_generation_history(jsonb) to authenticated;

comment on table public.recipe_generation_history is 'Memoria breve usada para evitar recetas repetidas con ingredientes similares.';
