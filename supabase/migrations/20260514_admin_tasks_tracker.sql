-- Tracker admin: tareas accionables que se generan automáticamente cuando
-- ocurre algo que requiere intervención del equipo admin.
--
-- Primer tipo soportado: 'estudio_economico_pendiente'. Se crea cuando un
-- supply recibe su primera factura. Diseñado para añadir más tipos en el
-- futuro (tarifa-vencida, prescoring-caducado, factura-no-extraida…).

-- 1. Tabla admin_tasks
CREATE TABLE IF NOT EXISTS public.admin_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type          text NOT NULL CHECK (type IN ('estudio_economico_pendiente')),
  supply_id     uuid REFERENCES public.supplies(id) ON DELETE CASCADE,
  client_id     uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'dismissed')),
  metadata      jsonb DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  completed_by  uuid REFERENCES public.users_profile(id) ON DELETE SET NULL,
  dismissed_at  timestamptz,
  dismissed_by  uuid REFERENCES public.users_profile(id) ON DELETE SET NULL
);

-- 2. Índices
CREATE INDEX IF NOT EXISTS idx_admin_tasks_status        ON public.admin_tasks(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_admin_tasks_supply        ON public.admin_tasks(supply_id);
CREATE INDEX IF NOT EXISTS idx_admin_tasks_client        ON public.admin_tasks(client_id);
CREATE INDEX IF NOT EXISTS idx_admin_tasks_type_status   ON public.admin_tasks(type, status);
-- Único parcial: solo UNA tarea pendiente por tipo+supply (evita duplicados)
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_tasks_unique_pending
  ON public.admin_tasks(type, supply_id)
  WHERE status = 'pending';

-- 3. Campo en supplies para guardar la URL del estudio económico subido
ALTER TABLE public.supplies
  ADD COLUMN IF NOT EXISTS economic_study_url       text,
  ADD COLUMN IF NOT EXISTS economic_study_filename  text,
  ADD COLUMN IF NOT EXISTS economic_study_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS economic_study_uploaded_by uuid REFERENCES public.users_profile(id) ON DELETE SET NULL;

-- 4. Función trigger: al insertar una factura, crear tarea si es la PRIMERA
--    factura del supply Y el supply aún no tiene estudio económico subido.
CREATE OR REPLACE FUNCTION public.create_estudio_task_on_first_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  supply_record       RECORD;
  existing_invoices   INTEGER;
  existing_task       INTEGER;
BEGIN
  -- Cargar el supply al que pertenece la factura
  SELECT id, client_id, economic_study_url INTO supply_record
  FROM public.supplies
  WHERE id = NEW.supply_id;
  IF supply_record IS NULL THEN RETURN NEW; END IF;

  -- Si el supply ya tiene un estudio subido, no creamos tarea
  IF supply_record.economic_study_url IS NOT NULL THEN RETURN NEW; END IF;

  -- ¿Esta es la primera factura del supply? (incluye la recién insertada)
  SELECT count(*) INTO existing_invoices
  FROM public.invoices
  WHERE supply_id = NEW.supply_id;
  -- Si hay más de 1, ya había facturas antes y, por tanto, ya se creó la
  -- tarea cuando entró la primera. No duplicamos.
  IF existing_invoices > 1 THEN RETURN NEW; END IF;

  -- Doble check anti-duplicación (por carrera concurrente): ¿ya existe una
  -- tarea pendiente para este supply?
  SELECT count(*) INTO existing_task
  FROM public.admin_tasks
  WHERE type = 'estudio_economico_pendiente'
    AND supply_id = NEW.supply_id
    AND status = 'pending';
  IF existing_task > 0 THEN RETURN NEW; END IF;

  -- Crear la tarea
  INSERT INTO public.admin_tasks (type, supply_id, client_id, status)
  VALUES ('estudio_economico_pendiente', NEW.supply_id, supply_record.client_id, 'pending')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

-- 5. Trigger en invoices (AFTER INSERT)
DROP TRIGGER IF EXISTS trg_create_estudio_task_on_first_invoice ON public.invoices;
CREATE TRIGGER trg_create_estudio_task_on_first_invoice
  AFTER INSERT ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.create_estudio_task_on_first_invoice();

-- 6. RLS — solo admins pueden ver/cambiar tareas
ALTER TABLE public.admin_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_tasks_admin_all ON public.admin_tasks;
CREATE POLICY admin_tasks_admin_all
  ON public.admin_tasks
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users_profile up
      WHERE up.id = auth.uid() AND up.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users_profile up
      WHERE up.id = auth.uid() AND up.role = 'admin'
    )
  );

-- 7. Backfill: tarea pendiente para todos los supplies que ya tienen al menos
--    una factura y no tienen estudio económico todavía. Sin duplicar si ya
--    hubiera una pendiente (raro, pero por seguridad).
INSERT INTO public.admin_tasks (type, supply_id, client_id, status, created_at)
SELECT DISTINCT
  'estudio_economico_pendiente',
  s.id,
  s.client_id,
  'pending',
  COALESCE(MIN(i.created_at), now())
FROM public.supplies s
JOIN public.invoices i ON i.supply_id = s.id
WHERE s.economic_study_url IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.admin_tasks t
    WHERE t.supply_id = s.id
      AND t.type = 'estudio_economico_pendiente'
      AND t.status = 'pending'
  )
GROUP BY s.id, s.client_id
ON CONFLICT DO NOTHING;
