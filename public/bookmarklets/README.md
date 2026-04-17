# Bookmarklets

## totalenergies-capture

Captura el token de sesión del portal de agentes TotalEnergies y lo sube al CRM (tabla `external_sessions.provider='totalenergies'`). Elimina la necesidad de actualizar `TOTALENERGIES_TOKEN` en Vercel.

### 1. Editar configuración

En `totalenergies-capture.js`:

```js
var CRM_URL = 'https://TU-DOMINIO-CRM.vercel.app'
var SECRET = 'PEGA_AQUI_EL_EXTERNAL_SESSION_SECRET'
```

El `SECRET` tiene que coincidir con la env var `EXTERNAL_SESSION_SECRET` que has puesto en Vercel. Genera uno con:

```bash
openssl rand -hex 32
```

### 2. Minificar a bookmarklet

```bash
# Usa uglify-js (o terser) y prefija con javascript:
npx uglify-js public/bookmarklets/totalenergies-capture.js -c -m \
  | awk 'BEGIN{printf "javascript:"} {printf "%s", $0}' \
  | pbcopy
```

Eso copia al clipboard la URL `javascript:…` completa.

### 3. Instalar

1. Crea un bookmark nuevo en la barra del navegador.
2. Nombre: `TE capture`.
3. URL: pega lo del clipboard.

### 4. Uso

1. Logueate en `https://agentes.totalenergies.es` como siempre.
2. Haz click en el bookmark.
3. Un banner dice "escuchando llamadas TE (8s)…". Mientras está visible, navega a cualquier pestaña del portal que dispare llamadas a la API (ej. abre el buscador de CUPS o una ficha). Eso ayuda al bookmarklet a interceptar el header `Authorization`.
4. Aparece un overlay con todos los tokens candidatos encontrados (cookies Gigya `st2.s.*`, localStorage, headers Authorization interceptados). Haz click en "Usar este" en el que tenga más pinta — normalmente el que viene de `fetch:Authorization` o `xhr:Authorization`.
5. Si se envía OK: alert "Token TE guardado. Caduca en X min".

Si aparece `expires_at` detectado del `gltexp_*`, se usa ese timestamp real. Si no, se asume 5 h.

### 5. Verificar desde el CRM

```bash
curl "https://TU-DOMINIO-CRM.vercel.app/api/external-session/status?provider=totalenergies"
```

Debería devolver `expires_at` y `minutes_remaining`.

### Troubleshooting

- **"No se detectaron candidatos"**: el bookmarklet no pilló ninguna llamada. Sal del overlay, navega por el portal (haz cualquier consulta SIPS en la UI), vuelve a ejecutar el bookmarklet.
- **El CRM devuelve 401 al usar el token**: probablemente copiaste un token equivocado (hay varios en localStorage). Repite con otro candidato del overlay.
- **CORS error**: revisa que el endpoint `/api/external-session/upsert` tenga el bloque `OPTIONS` y los headers `Access-Control-Allow-Origin: *`. Ya están en el código.
