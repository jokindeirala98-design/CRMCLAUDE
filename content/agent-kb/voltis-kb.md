# Conocimiento interno Voltis Energía

> **Edita este fichero** con la información real de Voltis. Lo que hay debajo
> es un esqueleto basado en lo que el agente puede deducir del CRM. Cuando
> esté completo ejecuta:
>
> ```bash
> node scripts/agent/ingest-markdown.mjs voltis_kb content/agent-kb/voltis-kb.md
> ```

---

## Qué es Voltis

Voltis Energía es una comercializadora y consultoría energética española con sede en Navarra. Combina:

- **Comercialización directa** de luz y gas a clientes B2B.
- **Consultoría energética**: auditoría, optimización de potencia, comparativas de tarifas.
- **Tecnología propia**: CRM con extracción automática de facturas, modelo de previsión de gasto, portal del cliente.

Ofrecemos ahorro medible y demostrable, no promesas vagas. Cada cliente tiene su propio portal donde ve su estudio económico, ahorros pre/post Voltis y previsión mensual.

---

## ICP — Cliente ideal de Voltis

**Segmento principal**: Ayuntamientos y PyMEs medianas (10-200 empleados) en Navarra y norte de España.

### Ayuntamientos
- Características: presupuesto público, decisor político (alcalde/concejal) + técnico (interventor o responsable de obras).
- Pain points: subidas de tarifas en los últimos años, falta de tiempo para auditar facturas, miedo a cambiar de comercializadora por trámites.
- Casos vivos en el CRM: **Ayuntamiento de Estella** (13 supplies de gas), **Ayuntamiento de Orcoyen**.
- Ciclo de decisión: 2-6 meses, requiere aprobación en pleno o de junta de gobierno.

### PyMEs
- Características: empresa familiar o profesionalizada, decisor único (gerente, CFO).
- Pain points: factura energética 5-15% del coste operativo, falta de visibilidad de a dónde va el gasto.
- Casos vivos en el CRM: **Unice Toys** (juguetes industriales, suministros mixtos luz + gas).
- Ciclo de decisión: 1-3 meses.

### Cliente NO ideal (filtrar)
- Particulares con tarifa doméstica 2.0TD baja (poco volumen, poco ahorro absoluto).
- Empresas con facturación energética <2.000€/mes (no compensa el esfuerzo comercial).
- Empresas con contratos activos a largo plazo sin penalización de salida razonable.

---

## Propuesta de valor

### Para ayuntamientos
1. **Auditoría energética gratuita** del último año.
2. **Estudio personalizado** mostrando ahorro previsto en €/año.
3. **Portal del cliente** (cliente.voltisenergia.com) para que el interventor y el secretario vean en tiempo real las facturas, consumos y ahorros.
4. **Gestión completa de cambios de tarifa y comercializadora** sin papeleo para el ayuntamiento.
5. **Reporting trimestral** automatizado.

### Para PyMEs
1. **Análisis SIPS** (datos oficiales del distribuidor) en 5 minutos.
2. **Comparativa con 4 escenarios**: comercializadora actual fiscal anterior, Voltis fiscal anterior, Voltis fiscal actual, Voltis tarifa real.
3. **Previsión anual mensualizada** con simulación basada en consumos reales del año anterior.
4. **Portal cliente** con facturas + dossier + comparativas descargables.

---

## Pricing y política de descuentos

### Estructura básica
- **Tarifa indexada al mercado mayorista (OMIE)** con margen comercial fijo.
- **Componente fija mensual** por punto de suministro.
- **Servicio premium** opcional: análisis trimestral + alertas anomalías.

### Cuándo se puede negociar
- **Volumen alto** (>100k kWh/año en luz o >50.000 m³/año en gas) → descuento progresivo.
- **Cliente referido por otro cliente actual** → 1 mes gratis a ambas partes.
- **Compromiso 12+ meses** vs 6 meses → mejora 3-5% del precio.

### Cuándo NO se baja el precio
- Primera objeción de un prospect sin haber descubierto sus consumos reales.
- A cambio de "voy a pensármelo".
- Sin contrapartida (volumen, plazo, referencia).

---

## Objeciones típicas y respuestas validadas

### "Ya estoy con otra comercializadora"
- Respuesta: "perfecto, ¿con cuál?".
- Si conocemos la comercializadora, mencionar 1 dato específico (subida de precios reciente, etc.).
- Pedir factura para analizar sin compromiso ("regalo el estudio aunque al final te quedes con ellos").
- Cierre: "te paso el estudio, si no aporta nada nos olvidamos; si aporta ahorro tú decides".

### "Cambiar es un follón"
- Respuesta: "lo único que hacéis vosotros es firmar un papel; del resto nos encargamos nosotros".
- Estadística: cero corte de suministro en el cambio. La transición es automática.
- Plazo: 21 días naturales para el cambio efectivo.

### "Sois muy nuevos / no os conozco"
- Respuesta: somos una consultora con clientes referenciables.
- Mencionar 2-3 casos similares (sin nombres confidenciales) por sector.
- Ofrecer prueba acotada (3 meses) si la objeción persiste.

### "Está fuera de presupuesto"
- Reframe a inversión: "no es un gasto adicional, es el mismo gasto a menor precio".
- Cuantificar: "ahora pagas X €/mes; con nosotros pagarías X−Y. La diferencia es Y x 12 = ahorro/año".
- Si el ahorro es <2.000€/año, reconocer que quizás Voltis no es la prioridad y agendar revisión en 6 meses.

### "Tengo que consultarlo con mi gestor / asesor / hijo"
- Aceptar y enriquecer: "perfecto, le paso material para que vea los números directamente".
- Agendar reunión a 3 con el asesor.
- Nunca dejarlo pendiente sin siguiente paso.

---

## Casos de éxito (rellenar con datos reales)

### Ayuntamiento de Estella
- Suministros: 13 puntos de gas distribuidos en colegios, polideportivo, ayuntamiento.
- Comercializadora previa: [añadir]
- Ahorro anual logrado: [añadir cifra real cuando esté disponible]
- Tiempo desde primer contacto hasta firma: [añadir]
- Testimonio: [añadir si lo tienes]

### Unice Toys
- Suministros: luz (3.0TD) + gas.
- Comercializadora previa: [añadir]
- Ahorro estimado año 2026: 302.711€ según documento oficial.
- Modelo aplicado: 4 escenarios (S0/S1/S2/S3) basado en Unice.
- Testimonio: [añadir si lo tienes]

### Ayuntamiento de Orcoyen
- Suministros: 5 supplies de gas.
- Estado: [añadir estado actual]

---

## Procesos comerciales

### Etapas del pipeline (CRM)
1. **primer_contacto**: prospect entra (Telegram, web, referido).
2. **estudio_en_curso**: análisis SIPS + auditoría de facturas.
3. **estudio_completado**: estudio listo para presentar.
4. **presentado**: reunión presencial o videocall hecha.
5. **pendiente_firma**: cliente conforme, esperando firma.
6. **firmado**: contrato firmado.
7. **suscrito**: alta en distribuidora completada.
8. **seguimiento_activo**: cliente activo, factura mensualmente.

### Criterios de avance
- Solo se avanza, nunca se retrocede.
- Si un prospect se enfría, no se mueve hacia atrás — se marca como "perdido temporal" con fecha de revisión.

---

## Voltis vs competencia (tener claro)

### Cuándo gana Voltis
- Cliente quiere transparencia y reporting visual claro.
- Cliente valora consultoría, no solo precio.
- Cliente quiere portal de seguimiento con sus datos.

### Cuándo gana la competencia
- Cliente solo mira el céntimo por kWh.
- Cliente quiere contrato a precio fijo plurianual (Voltis trabaja con indexado).
- Cliente busca grandes generadores integrados (Iberdrola, Endesa).

### Respuesta cuando el cliente menciona competidor concreto
- Reconocer que es un buen competidor.
- Diferenciar en lo que somos mejores (transparencia, consultoría, portal).
- Nunca criticar al competidor — eso resta credibilidad.

---

## Tono y guía de estilo Voltis

- **Profesional y directo**. Cero adornos vacíos.
- **Tuteo siempre** (incluso con ayuntamientos, mantenemos cercanía).
- **Específico antes que genérico**. "Ahorraréis 23.450€/año" > "ahorraréis mucho".
- **Honesto antes que comercial**. Si la solución no encaja, decirlo.
- **Sin emojis** en comunicación formal con clientes.
- **Cero promesas que no podamos cumplir**.
- **Datos > opiniones**. Siempre que se pueda, citar SIPS, factura, BOE o histórico.

---

## Identidad legal y operativa

- **Razón social**: Voltis Energía [completar].
- **CIF**: [completar].
- **Web**: https://voltisenergia.com
- **CRM interno**: voltis-crm-bueno.vercel.app
- **Portal cliente**: cliente.voltisenergia.com
- **Email comercial**: nicolasvoltis@gmail.com (Nicolás, fundador)
- **Atención cliente**: [completar]
- **Ubicación**: Navarra, España.
