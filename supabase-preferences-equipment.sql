-- Amplía el equipamiento permitido en las preferencias Premium.
-- Ejecutar una sola vez en Supabase SQL Editor.

alter table public.user_recipe_preferences
    drop constraint if exists user_recipe_preferences_equipment_check;

alter table public.user_recipe_preferences
    add constraint user_recipe_preferences_equipment_check
    check (
        equipment <@ array[
            'horno',
            'hornallas',
            'microondas',
            'air_fryer',
            'procesadora',
            'licuadora',
            'minipimer',
            'batidora',
            'olla_presion',
            'vaporera',
            'parrilla',
            'wok'
        ]::text[]
    );
