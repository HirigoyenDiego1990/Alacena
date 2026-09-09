-- Invierte el flujo de compras: la lista personal se llena solo por decisión del usuario.
-- Ejecutar una sola vez en Supabase SQL Editor.

alter table public.shopping_lists
    alter column weekly_plan_id drop not null,
    add column if not exists list_kind text not null default 'weekly';

alter table public.shopping_lists
    alter column list_kind set default 'personal';

alter table public.shopping_lists
    drop constraint if exists shopping_lists_list_kind_check;

alter table public.shopping_lists
    add constraint shopping_lists_list_kind_check
    check (list_kind in ('personal', 'weekly'));

alter table public.shopping_lists
    drop constraint if exists shopping_lists_kind_matches_plan;

alter table public.shopping_lists
    add constraint shopping_lists_kind_matches_plan
    check (
        (list_kind = 'personal' and weekly_plan_id is null)
        or (list_kind = 'weekly' and weekly_plan_id is not null)
    );

create unique index if not exists shopping_lists_one_personal_per_user_idx
on public.shopping_lists (user_id)
where list_kind = 'personal';

alter table public.shopping_list_items
    add column if not exists source_refs text[] not null default '{}'::text[];

alter table public.shopping_list_items
    drop constraint if exists shopping_list_items_source_type_check;

alter table public.shopping_list_items
    add constraint shopping_list_items_source_type_check
    check (source_type in ('recipe', 'plan', 'manual'));

alter table public.shopping_list_items
    drop constraint if exists shopping_list_items_source_refs_limit;

alter table public.shopping_list_items
    add constraint shopping_list_items_source_refs_limit
    check (cardinality(source_refs) <= 200);

drop policy if exists "premium users can insert own shopping lists" on public.shopping_lists;
create policy "premium users can insert own shopping lists"
on public.shopping_lists for insert to authenticated
with check (
    auth.uid() = user_id
    and public.is_current_user_premium()
    and (
        (list_kind = 'personal' and weekly_plan_id is null)
        or (
            list_kind = 'weekly'
            and exists (
                select 1 from public.weekly_plans
                where id = weekly_plan_id and user_id = auth.uid()
            )
        )
    )
);

drop policy if exists "premium users can update own shopping lists" on public.shopping_lists;
create policy "premium users can update own shopping lists"
on public.shopping_lists for update to authenticated
using (auth.uid() = user_id and public.is_current_user_premium())
with check (
    auth.uid() = user_id
    and public.is_current_user_premium()
    and (
        (list_kind = 'personal' and weekly_plan_id is null)
        or (
            list_kind = 'weekly'
            and exists (
                select 1 from public.weekly_plans
                where id = weekly_plan_id and user_id = auth.uid()
            )
        )
    )
);

comment on column public.shopping_lists.list_kind is 'Distingue la lista personal de las listas semanales anteriores.';
comment on column public.shopping_list_items.source_refs is 'Evita sumar dos veces la misma receta a un producto consolidado.';
