-- Ejecutar una sola vez en el SQL Editor de Supabase.
-- Carga atómica de varios ingredientes y actualización de cantidades existentes.

create or replace function public.add_pantry_ingredients_bulk(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_item jsonb;
    v_name text;
    v_unit text;
    v_quantity numeric;
    v_existing_id public.pantry.id%type;
    v_added integer := 0;
    v_updated integer := 0;
    v_total integer;
begin
    if v_user_id is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if p_items is null
       or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) < 1
       or jsonb_array_length(p_items) > 100 then
        raise exception 'INVALID_INGREDIENT_LIST';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 2));

    for v_item in select value from jsonb_array_elements(p_items)
    loop
        v_name := btrim(coalesce(v_item ->> 'name', ''));
        v_unit := lower(btrim(coalesce(v_item ->> 'unit', 'unidad')));

        begin
            v_quantity := (v_item ->> 'quantity')::numeric;
        exception when others then
            raise exception 'INVALID_INGREDIENT_QUANTITY';
        end;

        if char_length(v_name) < 1
           or char_length(v_name) > 100
           or v_quantity <= 0
           or v_quantity > 99999
           or v_unit not in ('unidad', 'g', 'kg', 'ml', 'l', 'taza', 'cda', 'cdita') then
            raise exception 'INVALID_INGREDIENT';
        end if;

        v_existing_id := null;
        select id into v_existing_id
        from public.pantry
        where user_id = v_user_id
          and lower(btrim(ingredient)) = lower(v_name)
          and lower(btrim(unit)) = v_unit
        order by id
        limit 1
        for update;

        if v_existing_id is null then
            insert into public.pantry (user_id, ingredient, quantity, unit)
            values (v_user_id, v_name, v_quantity, v_unit);
            v_added := v_added + 1;
        else
            update public.pantry
            set quantity = v_quantity,
                ingredient = v_name,
                unit = v_unit
            where id = v_existing_id
              and user_id = v_user_id;
            v_updated := v_updated + 1;
        end if;
    end loop;

    select count(*)::integer into v_total
    from public.pantry
    where user_id = v_user_id;

    return jsonb_build_object(
        'added_count', v_added,
        'updated_count', v_updated,
        'total_count', v_total
    );
end;
$$;

revoke all on function public.add_pantry_ingredients_bulk(jsonb) from public, anon, authenticated;
grant execute on function public.add_pantry_ingredients_bulk(jsonb) to authenticated;

comment on function public.add_pantry_ingredients_bulk(jsonb)
is 'Agrega varios ingredientes o reemplaza la cantidad disponible en una única transacción segura.';
