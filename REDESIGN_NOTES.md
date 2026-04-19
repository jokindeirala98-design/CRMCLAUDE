# Voltis CRM — Redesign v2 Notes

## Objetivo

Migrar de "Kinetic Precision" (azul marino + gradientes) a "Editorial + Instrumento" (neutros cálidos, verde bosque, acento volt). Sin romper funcionalidad. Backward compat: todas las clases Tailwind existentes siguen siendo válidas.

---

## Glosario de Terminología

| Concepto | Término oficial | Notas |
|---|---|---|
| CUPS | CUPS | Siempre en mayúsculas. "Suministro" es el objeto completo; "CUPS" es el identificador. |
| Cliente | Cliente | No "Lead" ni "Contacto". Un cliente puede estar en distintos estados. |
| Informe | Informe | No "Estudio". Un informe = documento generado. |
| Ahorro | Ahorro | No "Savings" ni "Economía". Siempre en castellano. |
| Contrato | Contrato | No "Acuerdo". |
| Factura | Factura | No "Invoice" en la UI. |
| Panel | Panel | No "Dashboard". |
| Bandeja | Bandeja de entrada | Abreviado "Bandeja" en nav. |

---

## Fases

### Fase 0 — Setup baseline

- REDESIGN_NOTES.md creado.
- Build verificado antes de empezar cambios visuales.

### Fase 1 — Tokens de diseño

**tailwind.config.ts**
- Paleta "Editorial": neutros cálidos (#FAFAF7, #141413), verde bosque (#1F3A2E), volt (#C7F24A)
- Tipografía: Geist (UI) + Geist Mono (CUPS/importes) + Instrument Serif (acento editorial)
- Estados semánticos en oklch
- Backward compat: colores primario/secondary/surface/on/outline/error/warning/success se mantienen con nuevos valores

**globals.css**
- Fuentes desde fonts.googleapis.com (Geist, Instrument Serif)
- CSS variables para colores raw
- Utilidades actualizadas: gradient-primary → fondo ink, focus-glow → ring border

### Fase 2 — Componentes UI

| Componente | Cambios |
|---|---|
| Button | Variantes: ink (estructural), volt (CTA destacado), ghost (secundario). Se mantienen props de API. |
| Badge | Dot 6px + borde 1px coloreado + bg semántico suave. StatusBadge preservado. |
| Card / StatCard | Border 1px en lugar de shadow-ambient-sm. Props preservados. |
| Input / Select | Focus ring border-based. Sin focus-glow. Props preservados. |
| DataTable | Headers mono uppercase. Filas tabular-nums. Props preservados. |

### Fase 3 — Layout

| Componente | Cambios |
|---|---|
| Sidebar | 3 grupos: General / Operación / Finanzas. Activo: bloque ink sólido. Avatar verde bosque. Corrección tilde "Configuración". |
| Header | Limpio. Inline-edit preservado. themeColor → #1F3A2E |
| BottomNav | 5 items: Panel / Bandeja / Clientes / Suministros / Menú |
| MobileDrawer | Estilos actualizados, mismos grupos que sidebar |

### Fase 4 — Panel *(pendiente)*

### Fase 5 — Clientes *(pendiente)*

### Fase 6 — Detalle cliente *(pendiente)*

### Fase 7 — Tablas *(pendiente)*

### Fase 8 — Resto de páginas *(pendiente)*

### Fase 9 — Limpieza *(pendiente)*

### Fase 10 — Copy y localización *(pendiente)*

---

## Decisiones de diseño

- **Solo un acento volt por pantalla.** El amarillo-verde #C7F24A es el CTA más prominente de cada vista. No se usa como color de estado.
- **Sombras → bordes.** Se reemplaza `shadow-ambient-sm` por `border border-outline-variant` en cards normales. Solo modales y dropdowns usan sombra ambiental.
- **Fuente mono para CUPS e importes.** Geist Mono da alineación y legibilidad a códigos y números financieros.

---

## Componentes extraídos a shared/ *(se completa en Fase 8)*

---

## Baseline de rendimiento *(se completa en Fase 9)*

| Página | Lighthouse Perf | Lighthouse A11y | Bundle |
|---|---|---|---|
| /panel | — | — | — |
| /clients/[id] | — | — | — |
