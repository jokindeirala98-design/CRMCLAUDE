# Tarjetas técnicas — Frameworks de venta consultiva A&C

> **Cómo usar este fichero**
>
> Cada `##` es una "tarjeta técnica": un framework concreto que el agente
> puede recuperar para asesorar al comercial. Estas son las plantillas
> iniciales basadas en el plan; **debes editarlas con la teoría y los
> ejemplos literales que Alfonso y Cristian enseñan en sus contenidos**.
> Cuando edites, mantén la estructura: contexto · framework · ejemplos ·
> errores comunes. Después ejecuta:
>
> ```bash
> node scripts/agent/ingest-markdown.mjs voltis_tarjetas_tecnicas content/agent-kb/tarjetas-tecnicas.md
> ```
>
> El script borra los chunks anteriores e indexa los nuevos.

---

## Objeción de precio — "somos caros"

**Cuándo se usa**: cliente B2B, decision-maker (CFO/Director Financiero) que dice "sois caros" o "no entra en presupuesto". Es la objeción más frecuente.

**Framework**:
1. No defender el precio inmediatamente — eso refuerza la objeción.
2. Aislar: "¿el precio es el único motivo por el que no avanzaríamos, o hay algo más?".
3. Cuantificar el coste de NO comprar: ahorro perdido por mes que no firme.
4. Reframe a inversión: "¿Cuánto perdéis hoy al mes con la tarifa actual? Lo que cobramos representa X% del ahorro que generamos."
5. Si el cliente sigue resistente, ofrecer prueba acotada (3 meses) en lugar de descuento.

**Ejemplos literales** (rellenar con citas reales de A&C):
- [pendiente: añadir cita del vídeo X de A&C]

**Errores comunes**:
- Bajar el precio en la primera objeción.
- Defender el precio antes de aislar la objeción.
- No cuantificar el coste de la inacción.

---

## Primera llamada en frío

**Cuándo se usa**: primera toma de contacto con un prospect.

**Framework de apertura** (15 segundos críticos):
1. Pattern interrupt: empezar con algo distinto a "buenos días, ¿qué tal?".
2. Razón concreta y específica: "Te llamo porque he visto que [observación específica del negocio]".
3. Pedir permiso para 30 segundos: "¿Tienes 30 segundos para que te explique por qué te llamo?".
4. Si dice no → "¿Cuándo te pillo mejor?" y agendar.

**Razones específicas para Voltis**:
- "He visto la factura de luz pública de vuestro ayuntamiento del 2025…"
- "Vuestra empresa entró en el SIPS con un nuevo CUPS este mes…"
- "Estáis con [comercializadora] desde hace [X] años y los precios han subido un [Y]%".

**Errores comunes**:
- Empezar con la propuesta de valor.
- No tener una razón específica del prospect.
- Hablar más de 30 segundos antes de pedir permiso.

---

## Descubrimiento — preguntas que abren

**Cuándo se usa**: tras la apertura, antes de proponer. Sirve para entender necesidades reales del cliente.

**Las 5 preguntas clave**:
1. ¿Cómo gestionáis hoy [el área del problema]?
2. ¿Qué es lo que mejor funciona de cómo lo hacéis?
3. ¿Qué cambiaríais si pudierais?
4. ¿Qué pasa si no cambiáis nada en 6-12 meses?
5. ¿Quién más participa en una decisión así?

**Reglas**:
- Una pregunta a la vez, escuchar.
- Profundizar con "¿y eso por qué?".
- Tomar notas. Repetir resumen al final ("entonces lo importante para ti es...").

**Errores comunes**:
- Saltar a la propuesta antes de descubrir.
- Asumir necesidades del cliente.
- No identificar al decisor real.

---

## Objeción "tenemos que pensarlo"

**Cuándo se usa**: cliente B2B aplaza la decisión sin razón concreta.

**Framework**:
1. Aceptar: "perfecto, lo entiendo".
2. Diagnosticar la verdadera razón: "¿qué es lo que más te hace dudar?".
3. Acotar plazo: "¿cuánto tiempo necesitas para pensarlo?".
4. Próximo paso concreto: "te llamo el [día] a las [hora] para resolver dudas".

**Mal patrón a evitar**:
- "Pues piensatelo y ya me dices" → la oportunidad se enfría.

**Errores comunes**:
- No agendar el siguiente contacto.
- Asumir que "pensarlo" es un sí.

---

## Identificar al decisor — múltiples interlocutores

**Cuándo se usa**: B2B con varios stakeholders (CEO, CFO, responsable de compras, técnico).

**Preguntas que descubren al decisor**:
- "¿Cómo suele decidir tu empresa en este tipo de inversiones?"
- "¿Quién más participa en la decisión final?"
- "¿Quién tiene la última palabra sobre el presupuesto?"

**Pista**: el decisor real raramente dice "yo decido". Si te dice "yo lo veo bien pero…" hay alguien más.

**Acción**:
- Pedir reunión con todos los implicados antes de presentar propuesta.
- Si no es posible, equipar al interlocutor para que venda internamente: dossier, números, casos de éxito.

---

## Cierre — propuesta y siguiente paso

**Cuándo se usa**: cliente ya ha visto valor y necesitas avanzar al siguiente paso.

**Framework de cierre suave**:
1. Resumir lo que has entendido: "entonces buscáis X y os preocupa Y".
2. Proponer solución específica: "lo que os recomendaría es Z".
3. Siguiente paso concreto y acotado: "¿qué te parece si quedamos el martes a las 10 para revisar la propuesta con tu equipo?".
4. Confirmar en el momento, no por email.

**Cierres a evitar**:
- "Bueno, ya te paso info y me dices" — muere ahí.
- "Cuando lo veas claro me dices" — pasividad.

---

## Follow-up que no es spam

**Cuándo se usa**: cliente no responde después de propuesta enviada.

**Estructura de email de seguimiento**:
1. Asunto corto referenciando la conversación previa.
2. Línea 1: contexto ("la semana pasada te pasé la propuesta de…").
3. Línea 2: aporta valor, no presiones (estudio, dato relevante, caso).
4. Línea 3: pregunta concreta y respondible ("¿es buen momento para una llamada de 15 min esta semana?").

**Cadencia**:
- Día 0: propuesta.
- Día 3: seguimiento con valor añadido.
- Día 7: pregunta directa "¿tiene sentido continuar o lo aparcamos?".
- Día 14: cierre suave "te llamo dentro de un trimestre".

**Errores comunes**:
- "Solo escribo para ver si has recibido mi email" → ruido.
- Más de un follow-up al día.
- No aportar valor en cada contacto.

---

## Preparación de reunión clave

**Cuándo se usa**: antes de cada reunión importante (cliente grande, segunda reunión, presentación a comité).

**Checklist 30 minutos antes**:
1. Revisar historial CRM completo del cliente.
2. Releer notas de la última reunión.
3. Listar 3 cosas que aprendí del cliente y se las recordaré.
4. Definir el objetivo concreto de la reunión (firma, agendar siguiente, presentar a otro stakeholder).
5. Anticipar 3 objeciones posibles y preparar respuesta.
6. Definir el "siguiente paso" que propondré.

**Durante la reunión**:
- Primer minuto: agradecer y confirmar tiempo disponible.
- Recordar lo último: "la última vez quedamos en…".
- Dejar al cliente hablar primero.
- Cerrar con siguiente paso concreto.

---

## Tono — venta consultiva, no comercial agresiva

**Principios generales** que el agente debe aplicar siempre:

1. **Honestidad antes que cierre**: si la solución no encaja, decirlo. Genera confianza a largo plazo.
2. **Especificidad gana a la genérica**: nunca "ahorraréis mucho", siempre "ahorraréis 23.450€/año".
3. **Preguntas > afirmaciones**: el que pregunta domina la conversación.
4. **Silencio**: tras una propuesta, callar. Quien habla primero pierde.
5. **No sobrevender**: la promesa que no se cumple cuesta 10 clientes.

---

## Errores frecuentes del comercial novato

Listado para que el agente reconozca patrones a mejorar en su comercial:

- **Hablar del producto antes de descubrir necesidades**.
- **Bajar precio sin pedir contraprestación** (volumen, plazo, referencia).
- **Confundir "interés" con "intención de compra"**.
- **No agendar el siguiente paso** al final de cada interacción.
- **Sobrevender beneficios genéricos** ("os ahorraréis mucho dinero").
- **No identificar al decisor** y perder tiempo con interlocutores sin poder.
- **No registrar las interacciones en el CRM** → conversación perdida.
- **Responder objeciones a la defensiva** en lugar de aislarlas.
- **Dejar al cliente decidir cuándo volver a hablar** → el cliente nunca llama.
- **Follow-up sin aportar valor** ("¿algo nuevo?").
