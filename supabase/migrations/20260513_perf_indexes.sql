-- Perf indexes — solo añaden, no modifican datos ni estructura.
-- Los índices compuestos aceleran joins/filtros típicos (ficha de cliente,
-- agenda por cliente, listados de informes). Los simples ya existen para
-- cada columna; estos cubren el patrón "filtra por X + ordena por Y" sin
-- necesidad de un sort en memoria.
--
-- 100 % retro-compatible: ningún índice se elimina ni se reemplaza. El
-- planner de PostgreSQL elige el mejor índice automáticamente.

-- Ficha cliente — informes ordenados por fecha
CREATE INDEX IF NOT EXISTS idx_audit_reports_client_updated
  ON public.audit_reports (client_id, updated_at DESC);

-- Ficha cliente — citas ordenadas por fecha
CREATE INDEX IF NOT EXISTS idx_appointments_client_scheduled
  ON public.appointments (client_id, scheduled_at DESC);

-- Ficha cliente — contratos por estado
CREATE INDEX IF NOT EXISTS idx_service_contracts_client_status
  ON public.service_contracts (client_id, status);

-- Hot path: "facturas pendientes" (re-extracción, dashboard, alertas).
-- Partial index → ocupa muy poco porque solo indexa las no-completed.
CREATE INDEX IF NOT EXISTS idx_invoices_pending_extraction
  ON public.invoices (supply_id)
  WHERE extraction_status <> 'completed';

-- Suministros por tipo + status (para listados filtrados en /supplies)
CREATE INDEX IF NOT EXISTS idx_supplies_type_status
  ON public.supplies (type, status);

-- Suministros por cliente + tipo (ficha cliente luz/gas)
CREATE INDEX IF NOT EXISTS idx_supplies_client_type
  ON public.supplies (client_id, type);

-- Facturas: filtro por source en un supply (Voltis vs históricas).
-- Complementa idx_invoices_supply_voltis (que es partial) con uno simétrico
-- para "histórica" y otras fuentes futuras.
CREATE INDEX IF NOT EXISTS idx_invoices_supply_source
  ON public.invoices (supply_id, source);
