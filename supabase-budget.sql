-- Ejecutar una sola vez en el SQL Editor de Supabase.
-- Presupuesto y control de gastos para las listas de compras Premium.
-- Requiere haber ejecutado previamente supabase-shopping-list.sql.

alter table public.shopping_lists
    add column if not exists budget_amount numeric(14, 2),
    add column if not exists currency text not null default 'ARS';

alter table public.shopping_list_items
    add column if not exists estimated_cost numeric(14, 2),
    add column if not exists actual_cost numeric(14, 2);

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'shopping_lists_budget_valid'
          and conrelid = 'public.shopping_lists'::regclass
    ) then
        alter table public.shopping_lists
            add constraint shopping_lists_budget_valid
            check (budget_amount is null or budget_amount between 0 and 999999999);
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'shopping_lists_currency_valid'
          and conrelid = 'public.shopping_lists'::regclass
    ) then
        alter table public.shopping_lists
            add constraint shopping_lists_currency_valid
            check (currency in ('ARS', 'USD', 'UYU', 'CLP', 'MXN', 'EUR'));
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'shopping_items_estimated_cost_valid'
          and conrelid = 'public.shopping_list_items'::regclass
    ) then
        alter table public.shopping_list_items
            add constraint shopping_items_estimated_cost_valid
            check (estimated_cost is null or estimated_cost between 0 and 999999999);
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'shopping_items_actual_cost_valid'
          and conrelid = 'public.shopping_list_items'::regclass
    ) then
        alter table public.shopping_list_items
            add constraint shopping_items_actual_cost_valid
            check (actual_cost is null or actual_cost between 0 and 999999999);
    end if;
end;
$$;

comment on column public.shopping_lists.budget_amount is 'Presupuesto máximo elegido para la compra semanal.';
comment on column public.shopping_lists.currency is 'Moneda usada en el presupuesto; no se realizan conversiones.';
comment on column public.shopping_list_items.estimated_cost is 'Costo total estimado para la cantidad indicada.';
comment on column public.shopping_list_items.actual_cost is 'Costo total realmente pagado por el producto.';
