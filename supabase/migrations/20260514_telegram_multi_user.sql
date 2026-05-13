-- Bot Telegram multi-usuario: vincular chat con un users_profile (comercial/admin)
-- y trazar qué usuario subió cada factura.
--
-- Compatibilidad: las columnas son nullable y se rellenan al completar el
-- onboarding. Las conversaciones existentes seguirán funcionando como antes
-- mientras user_profile_id sea NULL; al primer mensaje del bot detectaremos
-- ese estado y arrancaremos el onboarding.

-- 1. Vínculo chat → usuario del CRM
ALTER TABLE public.telegram_conversations
  ADD COLUMN IF NOT EXISTS user_profile_id UUID REFERENCES public.users_profile(id) ON DELETE SET NULL;

-- Índice para localizar el chat de un usuario (admin asignando factura a
-- comercial, comandos por usuario, etc.)
CREATE INDEX IF NOT EXISTS idx_telegram_conversations_user_profile
  ON public.telegram_conversations(user_profile_id);

-- 2. Quién subió la factura (puede ser commercial, admin o NULL para imports legacy)
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES public.users_profile(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_uploaded_by
  ON public.invoices(uploaded_by);

-- 3. Asegurar columna nickname en users_profile (puede existir ya en producción)
ALTER TABLE public.users_profile
  ADD COLUMN IF NOT EXISTS nickname TEXT;
