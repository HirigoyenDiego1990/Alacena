-- Ejecutar una sola vez en el SQL Editor de Supabase.
-- Agrega estructura culinaria sin eliminar ni invalidar datos existentes.

alter table public.pantry
    add column if not exists quantity numeric(10, 2),
    add column if not exists unit text;

update public.pantry
set quantity = 1
where quantity is null;

update public.pantry
set unit = 'unidad'
where unit is null or btrim(unit) = '';

alter table public.pantry
    alter column quantity set default 1,
    alter column quantity set not null,
    alter column unit set default 'unidad',
    alter column unit set not null;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'pantry_quantity_positive'
          and conrelid = 'public.pantry'::regclass
    ) then
        alter table public.pantry
            add constraint pantry_quantity_positive check (quantity > 0 and quantity <= 99999);
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'pantry_unit_length'
          and conrelid = 'public.pantry'::regclass
    ) then
        alter table public.pantry
            add constraint pantry_unit_length check (char_length(unit) between 1 and 30);
    end if;
end;
$$;

alter table public.saved_recipes
    add column if not exists required_ingredients jsonb not null default '[]'::jsonb,
    add column if not exists missing_ingredients jsonb not null default '[]'::jsonb,
    add column if not exists servings integer not null default 2,
    add column if not exists duration_minutes integer,
    add column if not exists recipe_type text not null default 'alacena',
    add column if not exists chef_tip text,
    add column if not exists tags text[] not null default '{}'::text[];

update public.saved_recipes
set duration_minutes = nullif(substring(time from '([0-9]+)'), '')::integer
where duration_minutes is null
  and time is not null
  and time ~ '[0-9]';

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'saved_recipes_required_ingredients_array'
          and conrelid = 'public.saved_recipes'::regclass
    ) then
        alter table public.saved_recipes
            add constraint saved_recipes_required_ingredients_array
            check (jsonb_typeof(required_ingredients) = 'array');
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'saved_recipes_missing_ingredients_array'
          and conrelid = 'public.saved_recipes'::regclass
    ) then
        alter table public.saved_recipes
            add constraint saved_recipes_missing_ingredients_array
            check (jsonb_typeof(missing_ingredients) = 'array');
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'saved_recipes_servings_positive'
          and conrelid = 'public.saved_recipes'::regclass
    ) then
        alter table public.saved_recipes
            add constraint saved_recipes_servings_positive check (servings between 1 and 100);
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'saved_recipes_duration_positive'
          and conrelid = 'public.saved_recipes'::regclass
    ) then
        alter table public.saved_recipes
            add constraint saved_recipes_duration_positive
            check (duration_minutes is null or duration_minutes between 1 and 1440);
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'saved_recipes_type_valid'
          and conrelid = 'public.saved_recipes'::regclass
    ) then
        alter table public.saved_recipes
            add constraint saved_recipes_type_valid
            check (recipe_type in ('alacena', 'sugerencia'));
    end if;
end;
$$;

create index if not exists saved_recipes_tags_idx
on public.saved_recipes using gin (tags);

create index if not exists saved_recipes_required_ingredients_idx
on public.saved_recipes using gin (required_ingredients);

comment on column public.pantry.quantity is 'Cantidad disponible del ingrediente.';
comment on column public.pantry.unit is 'Unidad culinaria de la cantidad disponible.';
comment on column public.saved_recipes.required_ingredients is 'Ingredientes estructurados con nombre, cantidad, unidad y disponibilidad.';
