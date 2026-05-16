# Voltis Energía — Modelo de negocio y proceso comercial

> Este es el knowledge base interno que el bot usa para hablar de Voltis con
> los comerciales. **Información validada, no inventada.** Si algo falta o
> está obsoleto, edítalo aquí y re-ingesta con `npm run agent:ingest-voltis`.

---

## Qué es Voltis

Voltis Energía es una **asesoría energética independiente** que ayuda a empresas, industria, ayuntamientos, hoteles, comunidades y particulares a pagar menos por la luz y el gas, sin papeleo, sin permanencia y sin sorpresas.

Combina tres cosas:
- **IA propia** (algoritmos predictivos sobre el mercado mayorista y análisis masivo de suministros).
- **Ingeniería energética** (análisis técnico de consumos, potencias, peajes, excesos).
- **Trato humano cercano** (cada cliente tiene un asesor asignado).

No es comercializadora. **Voltis no vende energía**, asesora y gestiona el contrato con la mejor comercializadora del mercado para cada caso.

Web: [voltisenergia.com](https://voltisenergia.com) · Teléfono: 747 474 360 · Email: admin@voltisenergia.com · Oficina: Parque Empresarial Ansoain (Calle Berriobide 38, Of. 209, 31013 Ansoáin, Navarra).

---

## La diferencia real frente a otros asesores energéticos

Esto es lo que el comercial tiene que tener clavado. No es un argumento de venta; es la verdad.

**Otros asesores ganan dinero con fees ocultos y tasas.** Cobran al cliente y también cobran del lado de la comercializadora una comisión que el cliente no ve. Resultado: el "asesor" recomienda a quien le paga más, no a quien ofrece la mejor tarifa al cliente.

**Voltis limpia el precio al máximo.** Solo cobra al cliente, y solo si hay ahorro. No tiene comisiones ocultas con comercializadoras. Trabaja con muchas (más de veinte) **sin casarse con ninguna**.

Y hace algo que un asesor tradicional no puede hacer: **agrupa paquetes de consumo de gran industria y ayuntamientos** para presentarlos juntos a las comercializadoras. Eso da volumen, y el volumen da precio. Una PyME sola no consigue ese descuento. Voltis sí, porque la mete en el paquete.

---

## Modelo económico

Dos modelos. **No conviven**, son **alternativos** según el volumen del ahorro anual estimado del cliente:

### Modelo A — Solo a éxito (25% sobre el ahorro)

- Voltis cobra **el 25% del ahorro total que le genera al cliente** respecto al año anterior.
- **Se activa cuando el ahorro anual estimado es ≥ 1.000 €/año.**
- Si no hay ahorro, no hay factura. Cero.
- Estudio inicial gratuito y sin permanencia.
- Habitual en industria, ayuntamientos, comercios con factura alta, comunidades grandes.

**Modalidades de pago del 25%:**
- **Pago único** a la firma del contrato.
- **Entrada 50% + 4 cuotas trimestrales de 12,5%** (cuando el cliente prefiere repartirlo).

### Modelo B — Suscripción trimestral

Cuando el ahorro anual estimado es **inferior a 1.000 €/año**. Tabla real (sin IVA):

| Ahorro anual estimado | Cuota trimestral |
|---|---|
| ≤ 200 € | **0 €** (Voltis no cobra; cliente entra para tenerlo gestionado) |
| 201 € – 350 € | **20 €/trimestre** |
| 351 € – 750 € | **45 €/trimestre** |
| 751 € – 999 € | **90 €/trimestre** |
| ≥ 1.000 € | pasa al **Modelo A — 25% éxito** |

Equivalencias anuales (sin IVA): 80 €, 180 €, 360 €.

**Reglas clave que el comercial debe tener claras:**
- La cuota se calcula **una vez al firmar**, en base al ahorro proyectado del estudio.
- Si el ahorro real luego sube o baja, no se reajusta al alza para el primer ciclo.
- En renovaciones, los tramos vigentes en el CRM hoy son: 19,99 €, 45 €, 90 € y 180 €/trimestre según el plan del cliente.
- Si un cliente pequeño no tiene apenas ahorro pero quiere acceso al software de gestión y soporte, hay un plan **Básico de 19,99€/trimestre** como puerta de entrada.

---

## La puerta de entrada: software de gestión energética

La optimización del contrato es **el primer paso**. Lo que viene después, y lo que diferencia a Voltis a medio plazo, es el **software de gestión energética** al que entra el cliente.

En el portal del cliente:
- Sus facturas centralizadas.
- Predicciones de gasto.
- Comparativas pre-Voltis vs Voltis con cifras reales.
- Informes anuales y por suministro.
- **Próximamente**: mediciones en directo de consumos.
- Atención personalizada del asesor asignado.

Esto es importante para el discurso: Voltis no es solo "te cambio el contrato y adiós". Es una **relación continua de gestión energética**.

---

## La IA propia — qué hace concretamente

Cuando un cliente técnico (jefe de mantenimiento, gerente de industria, interventor de ayuntamiento) pregunte por la IA, esto es lo que hace:

- **Algoritmos predictivos** sobre compras de paquetes de energía y gas en el mercado mayorista.
- **Análisis masivo de suministros**: cruza cientos de CUPS a la vez para detectar patrones.
- **Detección de excesos de potencia y maxímetros** (penalizaciones que el cliente está pagando sin saberlo).
- **Búsqueda de agrupaciones óptimas** según el perfil de consumo del cliente.
- Detección de **variaciones anómalas** de consumo y de precios.

No es un "GPT que escribe correos". Es ingeniería energética automatizada.

---

## Proceso comercial real

**Plazos reales (no los del workflow oficial que están inflados):**

- Del primer contacto al estudio presentado: **máximo 1 semana**.
- Del estudio al OK del cliente: depende del cliente.
- Del OK a la firma y alta: 1-4 semanas (la baja con la anterior la gestionamos nosotros).

### Cómo prospectan los comerciales

El equipo comercial **entra físicamente en zonas industriales y empresariales** ofreciendo el servicio puerta a puerta. Habla con quien está disponible en ese momento (recepción, encargado, dueño si está).

**Resultado más habitual de esa primera visita**: el interlocutor da una tarjeta y pide que se le llame o se le escriba más tarde. No suele soltar factura en el momento.

**Aquí es donde el comercial necesita más ayuda del bot**: en el follow-up tras la tarjeta, en convertir un "llámame la semana que viene" en un cliente que manda la factura.

### Cómo se hace el estudio (interno)

Cuando el cliente entrega facturas:

1. Análisis del consumo por periodos (cuartos horarios si aplica).
2. Detección de **excesos de potencia** y de maxímetros.
3. Análisis de tarifa actual: peajes, energía, término fijo.
4. Búsqueda de la **agrupación más óptima** según el perfil del cliente.
5. Cruce con las comercializadoras del momento.
6. Cálculo del ahorro anual respecto al año anterior.
7. Validación final del ingeniero responsable.
8. Preparación del documento de propuesta.

### Presentación al cliente y cierre

- Se presenta el estudio (presencial, videollamada o llamada según cliente).
- Se enseña ahorro estimado anual, comparativa antes/después, condiciones.
- Si el cliente da el OK → se activan los contratos con la nueva comercializadora.
- Voltis gestiona la baja con la anterior y el alta con la nueva. Cliente no firma nada con la antigua.

---

## Prueba social

**Más de 300.000€ ahorrados a la administración pública** hasta la fecha (cifra agregada, sin identificar clientes concretos).

> **Importante para el bot**: nunca des cifras concretas por cliente, nombres de personas ni datos identificativos sin confirmación expresa del comercial. La cifra global de 300k a administración pública sí es utilizable como prueba.

## Servicios y procesos que ofrece Voltis

### Servicios principales

- **Optimización del contrato eléctrico** (luz): análisis de tarifa actual, peajes, potencias contratadas por periodo, detección de excesos de potencia y maxímetros, búsqueda de la tarifa óptima del mercado en cada momento.
- **Optimización del contrato de gas**: incluida la posibilidad de **fórmula indexada** cuando el perfil del cliente lo justifica (precio variable ligado al mercado mayorista, suele ser ventajoso para grandes consumos).
- **Autoconsumo colectivo**: tramitación de instalaciones fotovoltaicas que dan servicio a varios puntos de suministro (típico en ayuntamientos: paneles en polideportivo o colegio que alimentan varios edificios municipales). Voltis colabora con ingenierías externas para la parte técnica.
- **CAE (Certificados de Ahorro Energético)**: tramitación cuanto antes para que el cliente pueda beneficiarse económicamente dentro de los plazos legales vigentes. Aplica a todos los clientes con potencial de ahorro certificable.
- **Gestión energética integral**: el cliente delega en Voltis toda la operativa energética. Voltis se ocupa de todo, el cliente no dedica tiempo.

### Procesos clave

**Antes de la firma**:
1. Análisis SIPS y/o recepción de facturas.
2. Estudio energético (máximo 1 semana desde primer contacto al estudio presentado).
3. Presentación de la propuesta al cliente.

**Justo después de la firma — primeras semanas**:
1. **Tramitación de gases** con la fórmula correspondiente (fija o indexada).
2. **Tramitación de los CAE** cuanto antes.
3. Cambio de comercializadora (Voltis gestiona altas y bajas con las comercializadoras anterior y nueva).
4. Alta del cliente en la plataforma de gestión energética.

**Mantenimiento mensual**:
1. Revisión automática de cada factura emitida.
2. Comparación con la mejor oferta del mercado.
3. Predicción de precios mediante IA propia.
4. Detección de desviaciones de consumo y anomalías.
5. Liquidaciones trimestrales o anuales según contrato.
6. Atención personalizada del asesor asignado.

### Tipos de documentos que entrega Voltis al cliente

- **Estudio energético inicial** (resumen anual de suministros con consumo, gasto y oportunidades de mejora detectadas).
- **Comparativa por trimestre**: panel comparativo del periodo contratado con Voltis frente a la comercializadora anterior, ajustado a consumos reales.
- **Previsión energética anual**: gasto previsto del ejercicio combinando importes reales facturados con una estimación basada en consumos SIPS del año anterior × precios fijos contractuales firmados con Voltis, incorporando la fiscalidad vigente.
- **Contrato de prestación de servicios profesionales** (Voltis ↔ cliente) — firmado primero por Voltis y enviado al cliente para que firme.
- **Propuesta económica del cliente** con el detalle del ahorro calculado.
- **Liquidaciones** trimestrales/anuales que detallan el ahorro real generado y, si aplica, la facturación de Voltis (25% sobre ahorro o suscripción).
- **Autofacturas** cuando aplica el régimen fiscal correspondiente.

### Colaboradores externos

Voltis trabaja con **ingenierías colaboradoras** para la parte técnica de proyectos especiales (instalaciones de autoconsumo, paneles fotovoltaicos, estudios eléctricos avanzados). Voltis lidera la relación con el cliente; la ingeniería aporta el aval técnico cuando hace falta.

### Reglas internas de relación con clientes

- Si el cliente pide aclaración sobre la metodología de un estudio, el comercial puede explicar a nivel general; para detalle técnico fino se deriva al equipo técnico.
- Cuando un cliente corrige un dato (ej. ortografía de su nombre o municipio), se asume la corrección sin reproches, se rectifica el documento y se reenvía con disculpa breve y sin excusas largas.
- Toda comunicación post-firma sigue el principio: **el cliente no debe hacer trabajo administrativo**. Voltis prepara, firma primero, y solo pide al cliente que revise y firme.

---

## Cobertura geográfica

**Operamos en toda España.** Las ciudades destacadas en la web (Madrid, Barcelona, Bilbao, Valencia, Málaga, Pamplona, Las Palmas) son donde hay más actividad de SEO y prospección directa, pero **se atiende a cualquier cliente del territorio nacional**. La oficina física está en Ansoáin (Navarra).

---

## Segmentos prioritarios

- Industria y fábricas (alto consumo, mucho ahorro).
- Ayuntamientos (segmento clave, casos referenciables).
- Hoteles, restaurantes, bares.
- PyMEs de 10-200 empleados.
- Comunidades de vecinos y residencias.
- Colegios.
- Particulares (más por suscripción).

---

## Objeciones más frecuentes y respuesta

**"No quiero líos con el cambio de compañía."**
Voltis gestiona todos los trámites. El cliente solo envía documentación y firma. La baja con la anterior la hacemos nosotros.

**"¿Y si luego no es cierto el ahorro?"**
Solo se cobra a éxito (25% del ahorro real). Si no hay ahorro, no hay factura. Y la IA sigue revisando precios cada semana después de la firma; si aparece algo mejor, se cambia.

**"¿Tengo que pagar permanencia con vosotros?"**
No. Cero permanencia. Cero letra pequeña.

**"¿Cuánto cuesta vuestro servicio?"**
Depende del modelo. Si el ahorro es grande: 25% del ahorro generado, solo si ahorras. Si vamos por suscripción: desde 19,99€/trimestre según tramo. El estudio inicial es gratis y sin compromiso.

**"Tengo que hablarlo con mi socio/asesor/gestor."**
Perfecto. Te dejo la propuesta por escrito y la ven juntos. ¿Cuándo os va bien que me pase a explicársela también a él/ella?

---

## Identidad

- **Razón social**: Voltis Energía.
- **Web**: https://voltisenergia.com
- **Email**: admin@voltisenergia.com
- **Teléfono**: 747 474 360
- **Oficina**: Calle Berriobide 38, Of. 209, 31013 Ansoáin, Navarra (Parque Empresarial Ansoain).
- **Fundador / email principal**: nicolasvoltis@gmail.com.
- **CRM interno**: voltis-crm-bueno.vercel.app (también accesible próximamente vía crm.voltisenergia.com).
- **Portal cliente**: cliente.voltisenergia.com.
