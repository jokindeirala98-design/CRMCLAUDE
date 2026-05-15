# Portal Cliente Voltis v2 — Plan estratégico

Documento de trabajo. Última edición: 2026-05-15. **Esta versión refleja las directrices del cliente tras revisar los 3 docs Unice Toys de referencia.**

---

## 1. Objetivo

Sustituir el sistema actual de dossier PDF + magic link por una **plataforma cliente profesional, independiente del CRM, accesible vía dominio propio**. El cliente entra con sus credenciales y dispone de tres productos vivos:

1. **Inicio** — Estudio económico global (lo que hoy tiene `/portal/[token]`).
2. **Ahorros** — Comparativa "qué hubieras pagado antes vs qué pagas con Voltis", filtrable por trimestre / semestre / año.
3. **Previsión** — Gasto previsto del próximo año mes a mes con metodología SIPS × precios Voltis (sin ajustes climáticos).

El portal **sustituye** al actual dossier PDF y al sistema de magic links por URL.

## 2. Decisiones tomadas

### 2.1 Autenticación

**Email + magic link como vía principal.** Sesión persistente de 30 días, renovable. Sin contraseñas que recordar.

**Onboarding:** durante el alta del cliente en el CRM, el comercial introduce el email del responsable (alcalde, gerente, controller, etc.). El sistema le manda un correo de bienvenida con un primer magic link. Una vez dentro, puede invitar a otros usuarios del mismo cliente.

**Multi-usuario por cliente:** sí. Cualquier cliente puede tener varios `portal_users` asociados, cada uno con su email. Esto resuelve el caso típico del ayuntamiento (alcalde + secretario + técnico de mantenimiento) o de la empresa (CEO + CFO + responsable de operaciones).

### 2.2 Arquitectura — Mismo codebase, aislamiento por RLS

**Decisión:** mismo proyecto Next.js, distinto subdominio. **No** segunda aplicación.

```
voltis-crm-bueno.vercel.app  → CRM interno (uso Voltis)
cliente.voltisenergia.com    → Portal cliente (uso final)
```

Más adelante (no en fase inicial), profesionalización:
- Migrar el CRM a un dominio propio (`crm.voltisenergia.com` o `app.voltisenergia.com`).
- Cuenta premium Vercel + Supabase.
- Auditoría de seguridad externa.

**Cómo se garantiza el aislamiento:**

1. **Middleware dual-host.** Detecta el `host` de la petición y aplica un routing distinto. Las rutas del CRM (`/dashboard/*`, `/clients/*`, `/supplies/*`, `/billing/*`, etc.) son **inaccesibles** desde `cliente.voltisenergia.com`. Cualquier intento de acceder a una ruta del CRM desde el subdominio cliente devuelve 404. Esto se valida con un test E2E en CI **antes de cada deploy**.

2. **Row Level Security obligatorio.** Todas las tablas de datos (`invoices`, `supplies`, `clients`, `consumption_snapshots`, `audit_reports`) llevan políticas RLS que cruzan `client_id` contra el `client_id` del JWT del usuario portal. Sin esto, no se sirve nada. Las claves de servicio (`SUPABASE_SERVICE_ROLE_KEY`) **no se usan jamás** en los endpoints del portal — solo las usa el CRM.

3. **Auth context separado.** El CRM usa Supabase Auth con `auth.users`. El portal usa una tabla `portal_users` propia con JWT custom. Cero solape — un usuario admin del CRM no entra automáticamente al portal de ningún cliente.

4. **Buckets de Storage segregados.** Los PDFs de facturas se sirven al portal mediante URLs firmadas con expiración de 10 minutos, generadas solo cuando se verifica el `client_id` del usuario. El portal nunca ve la URL pública de Storage.

5. **Logs de auditoría.** Cada acceso a datos del portal genera una entrada en `portal_audit_log` con `portal_user_id`, ruta, IP, timestamp. Si un cliente pregunta "¿quién ha entrado este mes?", se lo respondes en 2 segundos.

### 2.3 Modelo de datos

```sql
-- Usuarios del portal cliente (distintos de auth.users del CRM)
create table portal_users (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  email text unique not null,
  display_name text,
  role text not null default 'viewer',  -- 'viewer' | 'admin'
  invited_by uuid references portal_users(id),
  last_login_at timestamptz,
  created_at timestamptz default now()
);

-- Magic links (uso único, expiran en 30 minutos)
create table portal_magic_links (
  token text primary key,
  portal_user_id uuid not null references portal_users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz default now()
);

-- Sesiones persistentes (30 días)
create table portal_sessions (
  id uuid primary key default gen_random_uuid(),
  portal_user_id uuid not null references portal_users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  last_seen_at timestamptz default now(),
  user_agent text,
  ip inet,
  created_at timestamptz default now()
);

-- Log de auditoría
create table portal_audit_log (
  id bigserial primary key,
  portal_user_id uuid references portal_users(id),
  client_id uuid references clients(id),
  action text not null,         -- 'login' | 'view_invoice' | 'download_pdf' | ...
  resource_id uuid,             -- id del recurso accedido
  ip inet,
  user_agent text,
  occurred_at timestamptz default now()
);

-- Tarifas Voltis contratadas (necesario para Ahorro y Previsión)
create table voltis_contracts (
  id uuid primary key default gen_random_uuid(),
  supply_id uuid not null references supplies(id) on delete cascade,
  start_date date not null,
  end_date date,
  tariff text not null,         -- '2.0TD' | '3.0TD' | '6.1TD' | 'RL.4' | ...
  -- Precios energía por periodo (€/kWh) — peaje + p.fijo combinados
  precio_kwh_p1 numeric,
  precio_kwh_p2 numeric,
  precio_kwh_p3 numeric,
  precio_kwh_p4 numeric,
  precio_kwh_p5 numeric,
  precio_kwh_p6 numeric,
  -- Precios potencia por periodo (€/kW día) — solo luz
  precio_kw_dia_p1 numeric,
  precio_kw_dia_p2 numeric,
  precio_kw_dia_p3 numeric,
  precio_kw_dia_p4 numeric,
  precio_kw_dia_p5 numeric,
  precio_kw_dia_p6 numeric,
  -- Gas
  precio_kwh_gas numeric,
  termino_fijo_diario_gas numeric,
  -- Otros
  bono_social_mensual numeric,
  alquiler_equipos_mensual numeric,
  notas text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS — aplicada a TODAS las tablas que el portal lee
create policy "portal_users see only own client data"
  on invoices for select using (
    auth.jwt() ->> 'role' = 'portal_user'
    and supply_id in (
      select id from supplies
      where client_id = (auth.jwt() ->> 'client_id')::uuid
    )
  );
-- (mismas políticas para supplies, consumption_snapshots, voltis_contracts, etc.)
```

## 3. Módulos funcionales

### 3.1 Inicio — Estudio económico global

**Ya existe** en `/portal/[token]`. Lo migramos al nuevo entorno con login propio. Sin cambios funcionales en esta fase.

Contenido:
- Hero con nombre del cliente + mascota + chips de periodo / tipo.
- KPIs: gasto total, consumo anual oficial SIPS, suministros activos.
- Bloque electricidad (gasto, kWh, €/kWh, concentración por periodo).
- Bloque gas (gasto, kWh, €/kWh, nota TV Precio Fijo).
- Top consumidores / Top gastadores.
- Suministros a revisar (anomalías €/kWh).
- Evolución mensual gasto.
- Ranking completo de suministros.
- Descarga Excel global.

### 3.2 Ahorros — Comparativa pre-Voltis vs Voltis

**Estructura calcada del PDF "Ahorro eléctrico Unice Toys 1er Trimestre"** (ver `Ahorro electrico Unice Toys 1o Trimestre (ajustado a consumos).pdf` en el ZIP).

Pregunta que responde: **"¿Cuánto habría pagado con Voltis si hubiera consumido lo mismo que el año pasado?"**

Filtros disponibles:
- Trimestre actual / 1Q año / 2Q año / 3Q año / 4Q año
- Semestre actual / 1S año / 2S año
- Año natural completo
- Desde la activación con Voltis
- Personalizado

KPIs principales (4 cards en glass cobalto):

```
PAGÓ ANTES (REAL)              HABRÍA PAGADO CON VOLTIS
101.943 €                       81.792 €
consumo real 2025               mismo consumo, precios Voltis

AHORRO SOLO POR CAMBIO          AHORRO POR MENOR CONSUMO
20.151 €                        14.167 €
-19,77 % solo por la tarifa     resto hasta los 67.625 € reales
```

Descomposición visual del ahorro (barra horizontal apilada):
- Por cambio de tarifa (58,7 %)
- Por menor consumo (41,3 %)

Tabla "Precios Voltis aplicados (€/kWh por periodo)":
- P1 (punta), P2, P3, P6 (valle)
- Columnas: peaje energía / energía precio fijo / **precio total €/kWh**

Tabla "Estimación mes a mes":
- Mes / kWh (consumo histórico) / Coste energía estimado / Total factura estimado / Pagó real (antes) / Ahorro

Gráfico "Comparativa mes a mes (€)":
- 3 barras por mes: Pagó antes (real), Habría pagado con Voltis (mismo consumo), Pagó con Voltis (real)

Bloque metodología (info colapsable):
- Cómo se calcula la energía: consumo año anterior × precio Voltis por periodo
- Potencia y peajes de potencia: idénticos a las facturas reales Voltis (no dependen del consumo)
- Excesos de potencia: los reales aplicados por Voltis en sus facturas
- Impuesto eléctrico: tipo vigente cada mes
- Validación cruzada: la fórmula aplicada al consumo real Voltis reproduce las facturas con ±0,02 €

**Equivalente para gas** (ver `Ahorro gas Unice Toys 1o Trimestre (ajustado a consumos).pdf`):
- Tabla específica con concepto / unidad / precio antes / precio Voltis / variación %
- Comparativa de 4 escenarios:
  - S0 — Pagó real antes
  - S1 — Mismo consumo, precios Voltis, fiscalidad año anterior
  - S2 — Mismo consumo, precios Voltis, fiscalidad año actual
  - S3 — Pagó real con Voltis
- Descomposición:
  - Ahorro por cambio de tarifa = S0 – S1 (atribuible a Voltis)
  - Ahorro por cambio normativo = S1 – S2 (atribuible al regulador, no a Voltis — transparencia)
  - Ahorro por menor consumo = S2 – S3 (atribuible al cliente)

**Esto es lo que distingue a Voltis** de un comercial cualquiera: separar mérito propio del mérito del regulador. El cliente entiende que sois honestos.

### 3.3 Previsión — Gasto anual previsto

**Estructura calcada del PDF "Previsión Energética 2026 Unice Toys SL"** (ver el PDF en el ZIP).

Modelo de cálculo (sin grados-día, según directriz del cliente):

> **Para cada mes futuro, replicamos el consumo del mismo mes del año anterior según SIPS oficial y aplicamos los precios contractuales Voltis vigentes. Es una simulación de "si consumieras lo mismo que el año pasado, esto pagarías".**

Estructura del módulo:

**Sección 1 — Resumen ejecutivo del año**

KPIs grandes:
- Gasto total previsto del año (real Q1 + estimado Q2-Q4)
- Real ya facturado (€ y % del año)
- Estimado restante (€ y % del año)
- Luz total año (€ y % del total)
- Gas total año (€ y % del total)
- Factura media mensual (€)

Gráfico de barras año completo:
- Para cada mes 2 barras (luz + gas)
- Meses ya facturados: tono "real" (gris/azul claro)
- Meses previstos: tono "previsión" (azul vivo Voltis)
- Etiqueta "REAL" debajo de los meses ya facturados

**Secciones 2-5 — Detalle por trimestre**

Para cada trimestre (Q1, Q2, Q3, Q4):
- Header con badge "REAL" o "ESTIMACIÓN"
- KPIs: total trimestre, € luz + kWh luz, € gas + kWh gas, media mensual
- Gráfico de barras mensual del trimestre (Luz + Gas)
- Tabla detallada: mes / consumo luz / coste luz / consumo gas / coste gas / total mes
- Fila TOTAL Q

**Sección 6 — Metodología**

Bloques colapsables (visibles por defecto):
- Datos de partida:
  - Consumos meses ya facturados: cifras reales extraídas de las facturas Voltis.
  - Consumos meses futuros: consumos del mismo mes del año anterior según SIPS oficial.
  - Precios: tarifa Voltis contractual vigente según contrato.
- Fórmula de cálculo (luz, gas).
- Precisión validada: "El modelo reproduce las facturas Voltis reales con desviación < 0,5 %" (cuando aplicable).

**Sección 7 — Fiscalidad aplicada**

Tabla por periodos fiscales del año:
- IE luz (% según RDL vigente)
- IVA luz (% según RDL vigente y potencia contratada)
- IEH gas (€/GJ)
- IVA gas (% según RDL vigente)

Nota fiscal personalizada cuando aplique (ej. "El cliente con potencia >10 kW en 6.1TD mantiene el IVA al 21 % durante todo el ejercicio según RDL 7/2026").

**Sección 8 — Limitaciones y advertencias**

- Consumo real puede variar: la previsión asume mismo consumo que año anterior. Cambios operativos, estacionalidad atípica o eficiencia energética pueden alterar las cifras.
- Excesos de potencia (luz): no incluidos por ser impredecibles sin medición en tiempo real.
- Revisión: la previsión se actualiza automáticamente cada vez que llega una nueva factura.

**Acciones disponibles:**

- "Descargar Previsión en PDF" → genera un PDF idéntico al que envías hoy manualmente.
- "Descargar tabla Excel" → datos para integrar con la contabilidad del cliente.

### 3.4 Facturas

Vista por suministro con todas las facturas Voltis y pre-Voltis. Descarga directa del PDF original. Desglose económico inline (lo que ya tienes en `AnnualEconomics`).

### 3.5 Cuenta

- Datos del cliente (solo lectura desde el portal: nombre, CIF, dirección).
- Usuarios con acceso al portal (el rol `admin` puede invitar/revocar a otros).
- Log de accesos propios.
- Cerrar sesión.

## 4. Sincronización automática con el CRM

Como ambos apps comparten Supabase, la sincronización es **automática a nivel de base de datos**.

Eventos que actualizan el portal sin trabajo adicional:
- Subes una factura nueva desde el CRM → aparece en el portal en la siguiente visita (o en tiempo real si tiene la pestaña abierta gracias a Supabase Realtime).
- Añades un suministro al cliente → aparece en el portal.
- Actualizas el contrato Voltis del cliente (cambias precios) → la previsión y los ahorros se recalculan al vuelo.
- Marcas una factura como "verificada" → entra automáticamente en los estudios económicos.

**Suscripción en tiempo real** (opcional, no MVP):

```typescript
useEffect(() => {
  const channel = supabase
    .channel(`client-${clientId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'invoices',
        filter: `supply_id=in.(${supplyIds.join(',')})` },
      () => refresh()
    )
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}, [clientId])
```

## 5. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Filtración de datos entre clientes | Tests E2E obligatorios validando RLS en CI. No deploy si falla. |
| Cliente revoca email del responsable que se va | Admin del cliente revoca sesiones desde el portal. |
| Previsión imprecisa daña credibilidad | Disclaimer claro + tracking de calibración mostrando precisión histórica (p.ej. "Aciertos del último año: ±2,4 %"). |
| Comparativa de ahorro infla cifras al confundir mérito | Descomposición transparente (cambio de tarifa / cambio normativo / menor consumo). Voltis solo se atribuye lo suyo. |
| Datos pre-Voltis del cliente no están extraídos | En el onboarding del cliente, el CRM facilita subir las facturas antiguas para activar el módulo de Ahorros. |
| Caída del portal | Botón "exportar todos mis datos" siempre disponible. Sin lock-in. |
| Auditoría GDPR | `portal_audit_log` registra todos los accesos. Cliente puede solicitar export o borrado de sus datos. |

## 6. Roadmap por fases

| Fase | Duración | Entregable | Sustituye |
|---|---|---|---|
| **0** Setup | 1 sem | Subdominio + tablas portal_* + RLS + middleware dual-host + login magic link | — |
| **1** MVP Inicio | 2-3 sem | Migración del portal actual al nuevo entorno. Datos vivos. | Dossier PDF + magic link URL |
| **2** Ahorros luz | 2 sem | Módulo comparativa pre-Voltis vs Voltis para electricidad | PDF "Ahorro eléctrico" manual |
| **3** Ahorros gas | 1 sem | Idem para gas con análisis de 4 escenarios | PDF "Ahorro gas" manual |
| **4** Previsión | 3 sem | Motor de previsión anual mes a mes + PDF exportable | PDF "Previsión Energética" manual |
| **5** Multi-usuario + audit | 1 sem | Invitar usuarios al portal, log de accesos | — |
| **6** Pulido | 2 sem | Realtime, alertas básicas, explicador de factura | — |

**Total: ~13 semanas** para producto completo. **La fase 1 sola ya jubila el dossier PDF actual**.

## 7. Estándar visual

La estética es la que ya hemos pulido en `/portal/[token]`:
- Fondo cobalto único fijo (parallax tipo Apple).
- Glass cobalto en todos los paneles.
- Tipografía Geist/SF Pro Display para texto, mono para cifras.
- Mascota Voltis (bombilla) en hero y vacíos.
- Acento dorado solo en KPI principal (gasto del periodo).

Esta misma identidad se aplica en los 3 productos (Inicio, Ahorros, Previsión) para que el cliente sienta que es una plataforma única, no 3 informes pegados.

## 8. Próximos pasos

Inmediatos (siguiente semana):

1. **Decidir el dominio definitivo** del portal (`cliente.voltisenergia.com` por defecto).
2. **Crear las tablas `portal_users`, `portal_magic_links`, `portal_sessions`, `portal_audit_log`, `voltis_contracts`** en Supabase con RLS configurado.
3. **Configurar el subdominio en Vercel** + DNS + middleware dual-host.
4. **Decidir el origen de los datos de `voltis_contracts`** — ¿se llenan a mano por el comercial al firmar el contrato o se extraen automáticamente de la primera factura Voltis del cliente?

Tras eso, fase 1 (migración del portal actual) son 2-3 semanas de trabajo focalizado.

## 9. Anexos en el ZIP

Junto a este documento se entregan a Claude Design 3 PDFs de referencia que definen exactamente cómo se debe ver cada módulo:

1. `Previsión Energética 2026 Unice Toys SL.pdf` — referencia visual y estructural de la **sección Previsión**.
2. `Ahorro electrico Unice Toys 1er Trimestre.pdf` — referencia visual y estructural del módulo **Ahorros (luz)**.
3. `Ahorro gas Unice Toys 1er Trimestre.pdf` — referencia visual y estructural del módulo **Ahorros (gas)**, con análisis de 4 escenarios.

Estos 3 PDFs son **la definición funcional canónica** de qué tiene que contener cada sección. Claude Design debe respetar esa estructura y trasladarla a UI interactiva manteniendo la estética Voltis cobalto + glass.
