-- Distingue facturas "históricas" (la comercializadora antigua del cliente)
-- de "facturas con Voltis" (la nueva comercializadora contratada a través de Voltis,
-- p. ej. Galp, Axpo, Gana...).
--
-- Las facturas Voltis disparan automáticamente la comparativa de coste real
-- cuando existe la factura del mismo mes del año anterior.

-- 1) Columna `source` con default 'historica' para no romper datos existentes.
alter table public.invoices
  add column if not exists source text not null default 'historica';

-- 2) Constraint enum-like (PostgreSQL no tiene ENUM nativo en este esquema).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'invoices_source_check'
  ) then
    alter table public.invoices
      add constraint invoices_source_check
      check (source in ('historica', 'voltis'));
  end if;
end$$;

-- 3) Marca temporal de cuándo se subió como Voltis (auditoría).
alter table public.invoices
  add column if not exists voltis_uploaded_at timestamptz;

-- 4) Índice parcial: acelera la query "dame todas las facturas Voltis de un supply".
create index if not exists idx_invoices_supply_voltis
  on public.invoices (supply_id)
  where source = 'voltis';

-- 5) Índice parcial para parejas histórica / Voltis por (supply_id, period_start).
create index if not exists idx_invoices_supply_period
  on public.invoices (supply_id, period_start);
