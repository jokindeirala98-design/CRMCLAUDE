/* ==========================================================================
 * Voltis CRM · Bookmarklet: capturar token TotalEnergies y subirlo al CRM
 * --------------------------------------------------------------------------
 * Uso:
 *   1. Cambia CRM_URL y SECRET abajo a tus valores reales.
 *   2. Minifica este archivo (ver README abajo) y envuelve con "javascript:".
 *   3. Guarda el resultado como bookmark en la barra de favoritos.
 *   4. Cuando estés logueado en agentes.totalenergies.es, haz click.
 *
 * Flujo:
 *   - Recorre cookies (glt_*, gltexp_*), localStorage y sessionStorage
 *     buscando candidatos a token (Gigya st2.s.*, JWTs, strings largos).
 *   - Intercepta la próxima llamada fetch/XHR durante 8 s por si el token
 *     aparece en un header Authorization.
 *   - Muestra un overlay con los candidatos. Haces click en el correcto y
 *     lo POSTea a /api/external-session/upsert con X-Session-Key.
 * ==========================================================================
 */
(function () {
  'use strict'

  // ─── CONFIG ──────────────────────────────────────────────────────────────
  var CRM_URL = 'https://TU-DOMINIO-CRM.vercel.app' // ← EDITA
  var SECRET = 'PEGA_AQUI_EL_EXTERNAL_SESSION_SECRET' // ← EDITA
  var PROVIDER = 'totalenergies'
  // ─────────────────────────────────────────────────────────────────────────

  function $(tag, attrs, text) {
    var el = document.createElement(tag)
    if (attrs) for (var k in attrs) el.setAttribute(k, attrs[k])
    if (text != null) el.textContent = text
    return el
  }

  function gatherCookies() {
    var out = []
    var cs = document.cookie.split(';')
    for (var i = 0; i < cs.length; i++) {
      var kv = cs[i].trim().split('=')
      if (kv.length < 2) continue
      var name = kv[0]
      var val = kv.slice(1).join('=')
      try { val = decodeURIComponent(val) } catch (e) {}
      if (val.length >= 30) {
        out.push({ source: 'cookie', name: name, value: val })
      }
    }
    return out
  }

  function gatherStorage(storage, label) {
    var out = []
    try {
      for (var i = 0; i < storage.length; i++) {
        var k = storage.key(i)
        var v = storage.getItem(k) || ''
        if (v.length >= 50) out.push({ source: label, name: k, value: v })
      }
    } catch (e) {}
    return out
  }

  // Busca timestamp gltexp_* para calcular expires_at
  function findGigyaExp() {
    var re = /gltexp_[^=]+=([0-9]+)/
    var m = re.exec(document.cookie)
    if (m) return parseInt(m[1], 10) // seconds Unix
    return null
  }

  // Intenta extraer token de un valor arbitrario (objetos JSON anidados)
  function extractTokenFromValue(v) {
    if (!v || typeof v !== 'string') return null
    // Gigya st2
    var gm = v.match(/st2\.s\.[A-Za-z0-9_\-\.]+/)
    if (gm) return gm[0]
    // JWT clásico
    var jm = v.match(/eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/)
    if (jm) return jm[0]
    // Si el string entero parece token (>=50 chars, sin espacios)
    if (v.length >= 50 && /^[A-Za-z0-9_\-\.~+\/=]+$/.test(v)) return v
    return null
  }

  function classify(raw) {
    // Devuelve un array con tokens candidatos "limpios"
    var results = []
    var seen = {}
    function add(tok, from) {
      if (!tok || seen[tok]) return
      seen[tok] = true
      results.push({ token: tok, from: from })
    }
    raw.forEach(function (c) {
      var tok = extractTokenFromValue(c.value)
      if (tok) add(tok, c.source + ':' + c.name)
    })
    return results
  }

  // ─── Intercepta fetch/XHR para capturar Authorization: Bearer ... ───────
  var captured = []
  function installInterceptors() {
    try {
      var origFetch = window.fetch
      window.fetch = function (input, init) {
        try {
          var h = (init && init.headers) || (input && input.headers)
          if (h) {
            var auth = ''
            if (typeof h.get === 'function') auth = h.get('Authorization') || h.get('authorization') || ''
            else auth = h['Authorization'] || h['authorization'] || ''
            if (auth) captured.push({ source: 'fetch', name: 'Authorization', value: String(auth) })
          }
        } catch (e) {}
        return origFetch.apply(this, arguments)
      }

      var origSet = XMLHttpRequest.prototype.setRequestHeader
      XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        if (name && /^authorization$/i.test(name) && value) {
          captured.push({ source: 'xhr', name: 'Authorization', value: String(value) })
        }
        return origSet.apply(this, arguments)
      }
    } catch (e) {}
  }

  // ─── UI overlay ─────────────────────────────────────────────────────────
  function showOverlay(candidates, expUnix) {
    // Quitar overlay previo si existe
    var prev = document.getElementById('voltis-te-overlay')
    if (prev) prev.remove()

    var bg = $('div', { id: 'voltis-te-overlay', style: [
      'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.7)', 'z-index:2147483647',
      'display:flex', 'align-items:center', 'justify-content:center', 'font-family:system-ui,sans-serif',
    ].join(';') })

    var card = $('div', { style: [
      'background:#fff', 'color:#111', 'padding:20px 22px', 'border-radius:10px',
      'max-width:760px', 'width:92%', 'max-height:85vh', 'overflow:auto', 'box-shadow:0 20px 60px rgba(0,0,0,.35)',
    ].join(';') })

    var h = $('h2', { style: 'margin:0 0 6px;font-size:17px;' }, 'Voltis · capturar token TotalEnergies')
    var sub = $('p', { style: 'margin:0 0 14px;font-size:13px;color:#555;' },
      'Elige el token correcto. El que funciona suele ser el que aparece en fetch/xhr Authorization ' +
      'o el que empieza por "st2.s.".' +
      (expUnix ? ' Expiry detectado: ' + new Date(expUnix * 1000).toLocaleString() : ' (sin gltexp_ en cookies — se usará 5h por defecto)')
    )
    card.appendChild(h)
    card.appendChild(sub)

    if (candidates.length === 0) {
      card.appendChild($('p', { style: 'color:#b00;' }, 'No se detectaron candidatos automáticamente. Pega el token manualmente:'))
      var ta = $('textarea', { style: 'width:100%;height:90px;font-family:monospace;font-size:12px;' })
      var btnManual = $('button', { style: btnStyle('#2563eb') }, 'Enviar este token')
      btnManual.onclick = function () {
        var v = (ta.value || '').trim()
        if (v) send(v, expUnix)
      }
      card.appendChild(ta)
      card.appendChild(btnManual)
    } else {
      candidates.forEach(function (c, i) {
        var row = $('div', { style: 'border:1px solid #ddd;border-radius:6px;padding:10px 12px;margin:8px 0;' })
        var lbl = $('div', { style: 'font-size:11px;color:#666;margin-bottom:4px;font-weight:600;' },
          '#' + (i + 1) + ' · ' + c.from + ' · ' + c.token.length + ' chars')
        var val = $('div', { style: 'font-family:monospace;font-size:11px;word-break:break-all;color:#111;max-height:70px;overflow:auto;background:#f7f7f7;padding:6px;border-radius:4px;' },
          c.token.substring(0, 220) + (c.token.length > 220 ? '…' : ''))
        var btn = $('button', { style: btnStyle('#16a34a') }, 'Usar este')
        btn.onclick = function () { send(c.token, expUnix) }
        row.appendChild(lbl)
        row.appendChild(val)
        row.appendChild(btn)
        card.appendChild(row)
      })
    }

    var close = $('button', { style: btnStyle('#6b7280', true) }, 'Cerrar')
    close.onclick = function () { bg.remove() }
    card.appendChild(close)

    bg.appendChild(card)
    document.body.appendChild(bg)
  }

  function btnStyle(bg, subtle) {
    return [
      'margin:8px 4px 0 0', 'padding:' + (subtle ? '6px 12px' : '8px 14px'),
      'background:' + bg, 'color:#fff', 'border:none', 'border-radius:6px',
      'font-size:13px', 'font-weight:600', 'cursor:pointer',
    ].join(';')
  }

  function send(token, expUnix) {
    var expiresAt = expUnix
      ? new Date(expUnix * 1000).toISOString()
      : new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString()

    var payload = {
      provider: PROVIDER,
      token: token,
      expires_at: expiresAt,
      raw: { captured_at: new Date().toISOString(), origin: location.origin },
    }

    fetch(CRM_URL + '/api/external-session/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Key': SECRET },
      body: JSON.stringify(payload),
      mode: 'cors',
      credentials: 'omit',
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j } }) })
      .then(function (res) {
        if (res.ok && res.j.success) {
          alert('OK · Token TE guardado. Caduca en ~' + res.j.minutes_remaining + ' min.')
        } else {
          alert('ERROR: ' + (res.j && res.j.error ? res.j.error : 'respuesta inválida'))
        }
        var ov = document.getElementById('voltis-te-overlay')
        if (ov) ov.remove()
      })
      .catch(function (e) {
        alert('ERROR red: ' + e.message)
      })
  }

  // ─── Run ────────────────────────────────────────────────────────────────
  installInterceptors()

  var expUnix = findGigyaExp()

  // Primera pasada inmediata
  var rawNow = gatherCookies().concat(gatherStorage(localStorage, 'localStorage'))
                               .concat(gatherStorage(sessionStorage, 'sessionStorage'))
  // Esperamos 8s para cazar tokens en fetch/xhr, luego mostramos UI
  var waitMsg = $('div', {
    id: 'voltis-te-wait',
    style: 'position:fixed;top:16px;right:16px;background:#111;color:#fff;padding:10px 14px;border-radius:8px;z-index:2147483647;font-family:system-ui,sans-serif;font-size:13px;',
  }, 'Voltis · escuchando llamadas TE (8s)…')
  document.body.appendChild(waitMsg)

  setTimeout(function () {
    var w = document.getElementById('voltis-te-wait')
    if (w) w.remove()
    var all = rawNow.concat(captured)
    var candidates = classify(all)
    showOverlay(candidates, expUnix)
  }, 8000)
})();
