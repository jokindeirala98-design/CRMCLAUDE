# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos esenciales

```bash
# Desarrollo local
npm run dev          # Next.js en http://localhost:3000

# Verificación antes de commit (TypeScript estricto sin compilar)
npx tsc --noEmit --skipLibCheck

# Lint
npm run lint

# Scripts de importación de datos (correr desde el Mac, no desde el sandbox):
cd "/Users/jokindeirala/Desktop/VOLTIS CRM/voltis-crm"
node scripts/setup-gas-estella.mjs      # Crea los 13 suministros de gas de Estella
node scripts/update-gas-tariffs.mjs     # Actualiza campo tariff con RL real desde SIPS
node scripts/import-gas-economics.mjs   # Importa facturas gas desde Excel definitivo
```

> **Importante:** Los scripts `.mjs` acceden a Supabase y al sistema de archivos del Mac. Deben ejecutarse **desde el Mac** con la ruta real `/Users/jokindeirala/Desktop/VOLTIS CRM/voltis-crm`, no desde el sandbox de Cowork.

## Despliegue

- **Producción:** https://voltis-crm-bueno.vercel.app
- **Deploy:** `git push` al remote de GitHub → Vercel auto-deploys.
- **Git remote:** `https://github.com/jokindeirala98-design/CRMCLAUDE.git`
- **Usuario git:** `Voltis <nicolasvoltis@gmail.com>`

---

## Arquitectura general

**Next.js 14 App Router** + **Supabase** (PostgreSQL + Auth + Storage) + **Vercel**.

```
src/
  app/
    (auth)/            # Login, set-password — sin Sidebar
    (dashboard)/       # Todas las páginas autenticadas — con Sidebar + BottomNav
      clients/[id]/    # Ficha de cliente
      supplies/[id]/   # Ficha de suministro (página más compleja del CRM)
      agenda/          # Citas con el cliente
      billing/         # Facturación Voltis a clientes
      comparativas/    # Comparativas eléctricas y de gas
      informes/        # Informes de auditoría
      panel/           # Dashboard principal
      prescorings/     # Prescorings de clientes
      inbox/           # Bandeja de entrada (Telegram + email)
    api/               # API Routes — un directorio por dominio
  components/
    layout/            # Sidebar, Header, BottomNav, AuthProvider, GlobalSearch
    supply/            # AnnualEconomics, PowerStudy, GasExcelImport, ...
    clients/           # ClientDetailModal, ContractSection, ...
    modals/            # EconomicStudyModal, TechnicalAuditModal, BulkUploadModal, ...
    ui/                # Button, Badge, Card, DataTable, Toast, ...
  lib/
    supabase/          # client.ts (browser), server.ts (SSR), middleware.ts
    gemini.ts          # Extractor de documentos con Gemini (modelo auto-discovery)
    smart-invoice-extractor.ts  # 2-pass extraction con knowledge base
    sips.ts            # Fetching SIPS eléctrico via Greening API
    adxenergia.ts      # SIPS gas via ADX Energía (sesión PHP)
    totalenergies.ts   # SIPS gas via TotalEnergies / Gigya CDC
    supply-pipeline.ts # FSM de estados del suministro (solo avanza, nunca retrocede)
    boe-prices.ts      # Peajes BOE por tarifa y año (2025-2026)
    consumption-utils.ts  # normalizeTariff(), normalizeCUPS() — FUENTE ÚNICA DE VERDAD
    voltis-tariffs-2td.ts # Tarifas Voltis propias (2.0TD) para comparativas
    telegram.ts / telegram-process.ts  # Bot de Telegram
    ...
  stores/
    auth.ts            # Zustand: usuario autenticado + role + permissions
  types/
    database.ts        # Todos los tipos TypeScript del dominio
scripts/               # Scripts .mjs de importación masiva (ejecutar en Mac)
supabase/migrations/   # Migraciones SQL históricas
templates/             # Plantillas Excel para estudios económicos
```

---

## Base de datos Supabase

**Proyecto:** `wqzicwrmmwhnafaihhqh.supabase.co`

### Tablas principales

| Tabla | Descripción |
|---|---|
| `clients` | Clientes (empresa/particular/ayuntamiento). Tiene `commercial_id`, `type`, `ahorro_sugerido`. |
| `supplies` | Suministros (CUPS). Cada supply pertenece a un client. Campos clave: `type` ('luz'/'gas'), `tariff` (ej. '3.0TD', 'RL.4'), `status` (pipeline FSM), `consumption_data` (JSON), `power_study_result` (JSON). |
| `invoices` | Facturas. Vinculadas a un supply via `supply_id`. El campo `extracted_data` (JSON) contiene el resultado de Gemini + el desglose económico en `extracted_data.economics` (tipo `BillEconomics`). |
| `consumption_snapshots` | Resumen de consumo por suministro. Usado en informes de auditoría. |
| `audit_reports` | Informes de auditoría por cliente (ayuntamientos). |
| `service_contracts` | Contratos de servicio Voltis con el cliente. |
| `prescorings` | Prescorings de potencia para suministros 3.0TD/6.xTD. |
| `comercializadora_formats` | Knowledge base de formatos de factura por comercializadora (para el extractor). |
| `telegram_conversations` | Conversaciones del bot de Telegram (una por grupo/usuario). |

### Clientes Supabase

- **Browser:** `createClient()` de `@/lib/supabase/client` — sesión en cookies (no localStorage).
- **Server / API Routes:** `createServerSupabaseClient()` de `@/lib/supabase/server`.
- **Scripts externos:** `createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)` con service role.

### RLS

RLS activo. Los comerciales solo ven sus clientes. Los admins ven todo. Las API routes que necesitan acceso completo usan `SUPABASE_SERVICE_ROLE_KEY`.

---

## Dominio de negocio

**Voltis** es una comercializadora/consultora energética española. El CRM gestiona:

### Pipeline de suministros

Los suministros siguen un pipeline lineal gestionado por `advanceSupplyPipeline()` en `src/lib/supply-pipeline.ts`. Solo avanza, nunca retrocede (excepto `report_deleted`):

```
primer_contacto → estudio_en_curso → estudio_completado → presentado → pendiente_firma → firmado → suscrito → seguimiento_activo
```

### Tarifas

- **Electricidad:** 2.0TD (P1/P2/P3), 3.0TD (P1–P6), 6.1TD–6.4TD (P1–P6).
- **Gas:** RL.1–RL.5 (peaje de acceso a red de distribución). Más alto = mayor consumo.
- `normalizeTariff()` en `consumption-utils.ts` es la **fuente única de verdad** para normalizar cualquier formato de tarifa entrante (códigos SIPS, variantes de texto, etc.).
- `tariffPriority()` en `clients/[id]/page.tsx` determina el orden visual de suministros: electricidad antes que gas, tarifas más altas primero.

### CUPS

- Siempre 20 caracteres, empieza por `ES`. Si tiene 22, quitar los 2 últimos.
- `normalizeCups()` y `cupsBase20()` en `src/lib/utils/cups.ts`.
- Para comparar CUPS potencialmente con/sin sufijo: usar `sameCupsBase()`.

---

## Extracción de facturas

El extractor usa **Gemini** (modelo con auto-discovery y fallback chain: gemini-2.5-flash → flash-lite → 2.5-pro → 2.0-flash). El flujo completo:

1. **Ingreso:** por la web (`/api/analyze-invoice`), Telegram (`telegram-process.ts`), o email inbound.
2. **Smart extractor** (`smart-invoice-extractor.ts`): busca en `comercializadora_formats` si hay notas de extracción para esa comercializadora → hace 1 o 2 passes a Gemini.
3. **Resultado** se guarda en `invoices.extracted_data` con la estructura:
   ```json
   {
     "economics": { /* BillEconomics */ },
     "supply_type": "luz" | "gas",
     "comercializadora": "...",
     "cups": "ES..."
   }
   ```
4. El componente `AnnualEconomics.tsx` lee `extracted_data.economics` para mostrar el desglose anual.

### Estructura BillEconomics (tipo clave)

```typescript
interface BillEconomics {
  fechaInicio, fechaFin, cups, tarifa, comercializadora
  consumoTotalKwh, costeBrutoConsumo, costeNetoConsumo
  costeMedioKwh, costeMedioKwhNeto, totalFactura
  consumo: ConsumoItem[]    // por periodo P1-P6
  potencia: PotenciaItem[]  // por periodo P1-P6
  gasPricing?: GasPricing   // solo gas: precioKwh, terminoFijoDiario, impuestoHidrocarb, ivaTotal...
}
```

Si `gasPricing` está presente → el AnnualEconomics lo trata como suministro de gas.

---

## Módulo de gas (Ayuntamiento de Estella)

Los 13 suministros de gas del Ayto. Estella tienen una lógica especial:

- **CUPS:** todos empiezan por `ES0226060...`
- **Comercializadora:** Naturgy / Nedgia Navarra (distribuidora)
- **Datos históricos:** vienen de Excel (`Estella_Lizarra_Gas_DEFINITIVO.xlsx`) en un formato de filas etiquetadas (fila 1=CUPS, fila 4=Fecha Inicio, fila 8=Consumo MWh, etc.). El script `import-gas-economics.mjs` lo lee e importa.
- **Tarifa RL:** campo `supplies.tariff` debe ser 'RL.1'–'RL.5' (no 'gas') para que el CRM agrupe correctamente. El script `update-gas-tariffs.mjs` lo corrige usando datos del SIPS.
- Gas supplies **no usan el endpoint SIPS eléctrico**. Sus datos vienen exclusivamente de Excel via `GasExcelImport` o de los scripts de importación.

---

## SIPS

- **Eléctrico:** via [Greening API](https://api.greeningenergy.com) — `src/lib/sips.ts`. Credenciales: `GREENING_EMAIL` / `GREENING_PASSWORD`.
- **Gas (single):** ADX Energía (`adxenergia.ts`) con fallback a TotalEnergies (`totalenergies.ts`). Credenciales: `ADX_USER/ADX_PASSWORD` y `TOTALENERGIES_EMAIL/TOTALENERGIES_PASSWORD`.
- El SIPS eléctrico se auto-refresca al abrir la ficha de suministro si faltan maxímetros o reactiva.
- Los tokens/sesiones se cachean en memoria de proceso (Vercel serverless → se pierde entre cold starts).

---

## Telegram Bot

- Webhook en `/api/telegram` (verificación HMAC con `TELEGRAM_WEBHOOK_SECRET`).
- El bot recibe facturas (PDF/foto), documentos de identidad (CIF/NIF/IBAN), y comandos de texto.
- `telegram-process.ts` centraliza la lógica: extrae documentos con Gemini, busca/crea el supply en Supabase, avanza el pipeline.
- Cron diario a las 06:00 (L-V): `/api/telegram/daily-briefing`.

---

## Diseño y estilos

**Tailwind** con design tokens propios (ver `tailwind.config.ts`):

- Paleta "Editorial": neutros cálidos, verde bosque (`#1F3A2E`), volt (`#C7F24A`).
- Fuentes: Geist (UI), Geist Mono (CUPS/importes), Instrument Serif (acento editorial).
- Clases semánticas: `bg-bg-2`, `text-ink`, `text-ink-3`, `border-line-2-variant`, `text-brand`, `text-ok`, `text-err`, `text-warn`.
- Los colores legacy (`primary`, `secondary`, `surface`, etc.) siguen funcionando con nuevos valores.
- No usar `bg-white` / `text-black` directamente — usar las clases semánticas.

Terminología UI (ver `REDESIGN_NOTES.md`): Panel (no Dashboard), Factura (no Invoice en UI), Informe (no Estudio), Ahorro (no Savings), Bandeja (no Inbox).

---

## Crons (Vercel)

| Endpoint | Horario | Función |
|---|---|---|
| `/api/cron/daily-tasks` | 05:55 UTC diario | Tareas diarias generales |
| `/api/telegram/daily-briefing` | 06:00 UTC L-V | Resumen diario al bot de Telegram |
| `/api/cron/backup` | 02:00 UTC diario | Backup de datos a Google Sheets / Storage |
| `/api/health-gemini` | 08:00 UTC diario | Ping al modelo Gemini para warm-up y detección de fallos |

---

## Variables de entorno necesarias

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
GEMINI_API_KEY / GOOGLE_GEMINI_API_KEY
GREENING_EMAIL / GREENING_PASSWORD        # SIPS eléctrico
ADX_USER / ADX_PASSWORD                   # SIPS gas (ADX)
TOTALENERGIES_EMAIL / TOTALENERGIES_PASSWORD  # SIPS gas (TotalEnergies)
TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET
SIGNWELL_API_KEY_B64 / SIGNWELL_WEBHOOK_SECRET
GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY
VOLTIS_CONTRATACIONES_SHEET_ID
GOCARDLESS_ACCESS_TOKEN / GOCARDLESS_ENVIRONMENT / GOCARDLESS_WEBHOOK_SECRET
```
